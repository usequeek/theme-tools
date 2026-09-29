import { builders, generateCode, parseModule, type ProxifiedModule } from 'magicast';
import { UsageError } from './options.js';

/**
 * Edits to `theme.config.ts` for `queek theme add template|design`.
 *
 * The config is hand-edited by then, so it is edited through its AST with
 * magicast, never regex: magicast parses it, node locations anchor the
 * insertion, and magicast renders the new entry. Everything else stays
 * byte-identical — comments, formatting, quote style, trailing newline.
 *
 * Why locations and not the magicast proxy: `const config = { … }; export
 * default config;` (the shape the starter ships) aliases the object, and the
 * proxy does not follow the alias — `mod.exports.default` is an empty proxy
 * over the Identifier. And pushing into the live tree makes recast reprint
 * the surrounding array, reflowing separators and comments. A splice at an
 * AST-computed offset changes only the added bytes.
 */

/** An AST node, as magicast's parser leaves it: only the shape this file reads is typed. */
interface AstNode {
  type: string;
  name?: unknown;
  value?: unknown;
  computed?: unknown;
  properties?: unknown;
  elements?: unknown;
  declarations?: unknown;
  declaration?: unknown;
  id?: unknown;
  init?: unknown;
  key?: unknown;
  start?: unknown;
  end?: unknown;
  body?: unknown;
  [key: string]: unknown;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';

const offset = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

/** The object theme.config.ts declares as its config, located through magicast's AST. */
function configObjectOf(source: string): AstNode {
  let mod: ProxifiedModule;
  try {
    mod = parseModule(source);
  } catch (error) {
    throw new UsageError(`theme.config.ts does not parse (${(error as Error).message}). Fix it first — add writes nothing until it parses.`);
  }
  const root = (mod as unknown as { $ast?: unknown }).$ast;
  const body = isNode(root) && root.type === 'Program' && Array.isArray(root.body) ? (root.body as AstNode[]) : null;
  if (!body) throw new UsageError('theme.config.ts has no config the add command understands. Fix it first — add writes nothing until it parses.');
  const exported = body.find((node) => node.type === 'ExportDefaultDeclaration')?.declaration;
  if (isNode(exported) && exported.type === 'ObjectExpression') return exported;
  if (isNode(exported) && exported.type === 'Identifier' && typeof exported.name === 'string') {
    for (const node of body) {
      if (node.type !== 'VariableDeclaration' || !Array.isArray(node.declarations)) continue;
      for (const declaration of node.declarations as AstNode[]) {
        if (isNode(declaration.id) && declaration.id.type === 'Identifier' && declaration.id.name === exported.name &&
          isNode(declaration.init) && declaration.init.type === 'ObjectExpression') return declaration.init;
      }
    }
  }
  throw new UsageError('theme.config.ts has no config object as its default export (expected `const config = { … }; export default config;`). Fix it first — add writes nothing until it parses.');
}

function objectProperty(obj: AstNode, name: string): AstNode | null {
  if (!Array.isArray(obj.properties)) return null;
  return (obj.properties as AstNode[]).find((prop) =>
    (prop.type === 'ObjectProperty' || prop.type === 'Property') && !prop.computed &&
    ((isNode(prop.key) && prop.key.type === 'Identifier' && prop.key.name === name) ||
      (isNode(prop.key) && prop.key.type === 'StringLiteral' && prop.key.value === name))) ?? null;
}

/** The whitespace starting the line `offset` sits on — the indent new lines mimic. No pattern matching: a plain scan. */
function indentOfLine(source: string, offset: number): string {
  let start = offset;
  while (start > 0 && source[start - 1] !== '\n') start--;
  let end = start;
  while (end < source.length && (source[end] === ' ' || source[end] === '\t')) end++;
  return source.slice(start, end);
}

/** Render a value the way the new entry is written: single quotes, two-space indent, escaped. */
function renderValue(value: unknown): string {
  return generateCode(builders.literal(value), { quote: 'single', tabWidth: 2 } as Parameters<typeof generateCode>[1]).code;
}

/**
 * The last significant character between two offsets: whitespace, line and
 * block comments and string literals are skipped, so a comma inside a comment
 * never reads as a trailing comma. A small lexer, not a pattern for code.
 */
function lastSignificantChar(source: string, from: number, to: number): string | null {
  let last: string | null = null;
  let i = from;
  while (i < to) {
    const char = source[i]!;
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { i++; continue; }
    if (char === '/' && source[i + 1] === '/') {
      while (i < to && source[i] !== '\n') i++;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < to && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      i++;
      while (i < to) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) break;
        // A template literal's holes hold code, not text — but only the last
        // character matters here, and a hole cannot end the span.
        i++;
      }
      i++;
      last = quote;
      continue;
    }
    last = char;
    i++;
  }
  return last;
}

const newlineOf = (source: string): string => (source.includes('\r\n') ? '\r\n' : '\n');

/**
 * Edit a CRLF file (a Windows checkout, many Windows editors) as LF and give it back
 * as CRLF. The parser's node offsets do not line up with a CRLF source, so an edit
 * spliced at them lands mid-line and rewrites its neighbours (Windows CI, 29/9/26).
 */
function preservingLineEndings(source: string, edit: (lf: string) => string): string {
  if (!source.includes('\r\n')) return edit(source);

  return edit(source.replace(/\r\n/g, '\n')).replace(/\r?\n/g, '\r\n');
}

/**
 * `key: value` freshly rendered, spliced before the object's closing brace.
 * The text between the last property and the brace decides the comma: a
 * trailing comma already there means none is added, otherwise one is.
 */
function insertProperty(source: string, obj: AstNode, key: string, renderedValue: string): string {
  let end = offset(obj.end);
  if (end === null || end < 1) throw new UsageError('theme.config.ts has a config object the add command cannot place an entry in. Fix it first — add writes nothing until it parses.');
  const properties = Array.isArray(obj.properties) ? (obj.properties as AstNode[]) : [];
  const last = properties[properties.length - 1];
  const lastEnd = last ? offset(last.end) : null;
  // The comma belongs right after the last property, not at the insertion
  // point before the closing brace — splice it there first.
  if (last && lastEnd !== null && lastSignificantChar(source, lastEnd, end - 1) !== ',') {
    source = `${source.slice(0, lastEnd)},${source.slice(lastEnd)}`;
    end += 1;
  }
  const newline = newlineOf(source);
  const outer = indentOfLine(source, end - 1);
  const inner = `${outer}  `;
  // The closing brace usually starts its own line already; only add a break
  // when it does not, so no blank line appears.
  const before = source[end - 2];
  const lead = before === '\n' || before === '\r' ? '' : newline;
  const value = renderedValue.split('\n').join(`${newline}${inner}`);
  const text = `${lead}${inner}${key}: ${value}${newline}${outer}`;
  return `${source.slice(0, end - 1)}${text}${source.slice(end - 1)}`;
}

/** Push a demos[] entry, creating the array when the config has none. Everything else stays byte-identical. */
export function appendDemoEntry(source: string, entry: Record<string, unknown>): string {
  return preservingLineEndings(source, (lf) => appendDemoEntryLf(lf, entry));
}

function appendDemoEntryLf(source: string, entry: Record<string, unknown>): string {
  const config = configObjectOf(source);
  const demos = objectProperty(config, 'demos');
  const newline = newlineOf(source);
  // The array rendered whole (`[ { … } ]`): insertProperty re-indents its
  // continuation lines under the new `demos:` key.
  if (!demos) return insertProperty(source, config, 'demos', renderValue([entry]));
  if (!isNode(demos.value) || demos.value.type !== 'ArrayExpression' || !Array.isArray(demos.value.elements)) {
    throw new UsageError('theme.config.ts `demos` is not an array. Fix it first — add writes nothing until it parses.');
  }
  const elements = demos.value.elements as AstNode[];
  const rendered = renderValue(entry);
  if (elements.length === 0) {
    const start = offset(demos.value.start);
    const end = offset(demos.value.end);
    if (start === null || end === null) throw new UsageError('theme.config.ts has a `demos` array the add command cannot place an entry in.');
    const outer = indentOfLine(source, start);
    const body = rendered.split('\n').join(`${newline}${outer}  `);
    return `${source.slice(0, start + 1)}${newline}${outer}  ${body}${newline}${outer}${source.slice(end - 1)}`;
  }
  const lastElement = elements[elements.length - 1]!;
  const lastEnd = offset(lastElement.end);
  const lastStart = offset(lastElement.start);
  if (lastEnd === null || lastStart === null) throw new UsageError('theme.config.ts has a `demos` entry the add command cannot place an entry after.');
  const indent = indentOfLine(source, lastStart);
  const body = rendered.split('\n').join(`${newline}${indent}`);
  return `${source.slice(0, lastEnd)},${newline}${indent}${body}${source.slice(lastEnd)}`;
}

/**
 * Set `design_label` on the main design (`designId: 'default'` → default_demo)
 * or a demos[] entry, replacing it when present. Everything else stays byte-identical.
 */
export function setDesignLabel(source: string, designId: string, label: string): string {
  return preservingLineEndings(source, (lf) => setDesignLabelLf(lf, designId, label));
}

function setDesignLabelLf(source: string, designId: string, label: string): string {
  const config = configObjectOf(source);
  let target: AstNode | null = null;
  if (designId === 'default') {
    const main = objectProperty(config, 'default_demo');
    if (!main || !isNode(main.value) || main.value.type !== 'ObjectExpression') {
      throw new UsageError('theme.config.ts has no `default_demo` object to name. Fix it first — add writes nothing until it parses.');
    }
    target = main.value;
  } else {
    const demos = objectProperty(config, 'demos');
    const elements = demos && isNode(demos.value) && demos.value.type === 'ArrayExpression' && Array.isArray(demos.value.elements)
      ? (demos.value.elements as AstNode[])
      : null;
    if (!elements) throw new UsageError('theme.config.ts has no `demos` array holding the design. Fix it first — add writes nothing until it parses.');
    target = elements.find((element) => {
      if (!isNode(element) || element.type !== 'ObjectExpression') return false;
      const id = objectProperty(element, 'id');
      return !!id && isNode(id.value) && id.value.type === 'StringLiteral' && id.value.value === designId;
    }) ?? null;
    if (!target) throw new UsageError(`theme.config.ts has no demos[] entry with id "${designId}". Fix it first — add writes nothing until it parses.`);
  }
  const current = objectProperty(target, 'design_label');
  if (current && isNode(current.value)) {
    const start = offset(current.value.start);
    const end = offset(current.value.end);
    if (start === null || end === null) throw new UsageError('theme.config.ts has a `design_label` the add command cannot replace.');
    return `${source.slice(0, start)}${renderValue(label)}${source.slice(end)}`;
  }
  return insertProperty(source, target, 'design_label', renderValue(label));
}
