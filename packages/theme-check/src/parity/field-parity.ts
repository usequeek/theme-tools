import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseVariantImplementations, type ManifestVariants } from './variant-parity.js';

/** Rendered by PageRenderer/preview hydration, never merchant-authored block data. */
const FRAMEWORK_PROVIDED_FIELDS = new Set([
  'bg_color', 'bg_image', 'bg_overlay', 'anchor_id',
  'products', 'categories', 'posts',
]);
/** `fields` is merchant-authored page-block data, written per section. */
const PAGE_BLOCK_SCOPES = new Set(['content', 'products', 'categories', 'gallery', 'contact', 'faq', 'table', 'blog']);
/**
 * Theme chrome — set once per store through `manage_theme`, not per page block.
 * A different write path, but the same contract: a chrome variant declares
 * exactly what its component renders, so ManageThemeTool's per-variant gate
 * (`chromeSupports()`, queek_backend) refuses an edit that would render nothing
 * instead of confirming a silent no-op.
 */
const CHROME_SCOPES = new Set(['header', 'footer', 'subscribe']);
/**
 * Variants whose configured values never arrive as component props, so a
 * props-read scan cannot see them. Each set is the field list read from the
 * real source, verified against the renderer named beside it — never a guess.
 */
const NON_PROP_VARIANT_READS: Record<string, string[]> = {
  // PageRenderer routes the default content block to CoreContentDefaultBlock.
  'content.default': ['markdown'],
  // vendor-shell.tsx mounts the core subscribe app from `config.apps.subscribe`.
  'subscribe.inline': ['heading', 'tagline', 'cta'],
  'subscribe.floating': ['heading', 'tagline', 'cta'],
  'subscribe.modal': ['heading', 'tagline', 'cta', 'trigger'],
  // Theme-bespoke subscribe panels live INSIDE the theme's own footer component
  // and read the same `config.apps.subscribe` off context rather than props —
  // see themes/allure/footers/atelier.tsx and themes/glow/footers/columns.tsx.
  'subscribe.atelier-hero': ['heading', 'tagline', 'cta'],
  'subscribe.glow-benefits': ['heading', 'tagline', 'cta'],
};
/**
 * Read-side prop names that resolve to a canonical snake_case manifest field.
 * Manifest fields are snake_case everywhere (they name the stored config/block
 * key), and `HeaderProps` (@usequeek/theme-kit/types/theme) re-exposes
 * `config.header.show_*` as camelCase React props — so every theme header reads
 * `showCart` for the field the merchant and the backend both call `show_cart`.
 *
 * The `cta*` pair is migration debt, not a boundary: allure's
 * `gallery/tab-collage` stored `ctaLabel`/`ctaLink` before the snake_case
 * rename, and its component still reads both so already-saved blocks keep
 * their button. Drop those two entries once that stored data is migrated.
 */
const FIELD_READ_ALIASES: Record<string, string> = {
  showSearch: 'show_search',
  showCart: 'show_cart',
  showAccount: 'show_account',
  showOffers: 'show_offers',
  ctaLabel: 'cta_label',
  ctaLink: 'cta_link',
};

export interface FieldParityViolation {
  variant: string;
  reason: string;
}

function componentError(fileName: string, componentName: string, detail: string): Error {
  return new Error(`${fileName}: ${componentName} ${detail}`);
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function findComponent(sourceFile: ts.SourceFile, componentName: string): ts.FunctionLikeDeclarationBase {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === componentName) return statement;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== componentName) continue;
      if (declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
        return declaration.initializer;
      }
    }
  }
  throw componentError(sourceFile.fileName, componentName, 'must be declared as a function or arrow function in its imported module');
}

function fieldsFromBindingPattern(
  pattern: ts.ObjectBindingPattern,
  fileName: string,
  componentName: string,
): string[] {
  const fields: string[] = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) {
      throw componentError(fileName, componentName, 'uses a rest props binding; field reads are not statically provable');
    }
    const field = element.propertyName
      ? propertyName(element.propertyName)
      : ts.isIdentifier(element.name) ? element.name.text : null;
    if (!field || !ts.isIdentifier(element.name)) {
      throw componentError(fileName, componentName, 'uses an unsupported props binding; field reads are not statically provable');
    }
    fields.push(field);
  }
  return fields;
}

/** Extracts direct field reads from one concrete variant component. */
export function extractComponentFieldReads(source: string, componentName: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = findComponent(sourceFile, componentName);
  const firstParam = component.parameters[0];
  if (!firstParam) return [];

  const fields = new Set<string>();
  let propsIdentifier: string | null = null;

  if (ts.isObjectBindingPattern(firstParam.name)) {
    for (const field of fieldsFromBindingPattern(firstParam.name, fileName, componentName)) fields.add(field);
  } else if (ts.isIdentifier(firstParam.name)) {
    propsIdentifier = firstParam.name.text;
  } else {
    throw componentError(fileName, componentName, 'uses an unsupported props parameter; field reads are not statically provable');
  }

  if (!propsIdentifier || !component.body) return [...fields].sort();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === propsIdentifier) {
      for (const field of fieldsFromBindingPattern(node.name, fileName, componentName)) fields.add(field);
    }

    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === propsIdentifier) {
      fields.add(node.name.text);
    }

    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === propsIdentifier) {
      if (!node.argumentExpression || !ts.isStringLiteral(node.argumentExpression)) {
        throw componentError(fileName, componentName, 'uses dynamic props access; field reads are not statically provable');
      }
      fields.add(node.argumentExpression.text);
    }

    if (
      (ts.isJsxSpreadAttribute(node) || ts.isSpreadElement(node))
      && ts.isIdentifier(node.expression)
      && node.expression.text === propsIdentifier
    ) {
      throw componentError(fileName, componentName, 'forwards props through a spread; field reads are not statically provable');
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(component.body, visit);
  return [...fields].sort();
}

/** Enforces equality after removing the explicit fields rendered by PageRenderer. */
export function validateFieldParity(
  themeSlug: string,
  variantKey: string,
  declaredFields: string[],
  componentReads: string[],
): void {
  const declared = new Set(declaredFields.filter((field) => !FRAMEWORK_PROVIDED_FIELDS.has(field)));
  const reads = new Set(
    componentReads
      .map((field) => FIELD_READ_ALIASES[field] ?? field)
      .filter((field) => !FRAMEWORK_PROVIDED_FIELDS.has(field)),
  );
  const declaredOnly = [...declared].filter((field) => !reads.has(field)).sort();
  const readOnly = [...reads].filter((field) => !declared.has(field)).sort();

  if (declaredOnly.length > 0 || readOnly.length > 0) {
    const reasons = [
      declaredOnly.length > 0 ? `declares ${declaredOnly.join(', ')} but the component never reads ${declaredOnly.length === 1 ? 'it' : 'them'}` : null,
      readOnly.length > 0 ? `reads ${readOnly.join(', ')} but the manifest does not declare ${readOnly.length === 1 ? 'it' : 'them'}` : null,
    ].filter(Boolean).join('; ');
    throw new Error(`Theme "${themeSlug}" ${variantKey} ${reasons}`);
  }
}

/** The nearest folder above `from` with a tsconfig.json or package.json — what `@/` means in a theme's project. */
function projectRootOf(from: string): string {
  let dir = from;
  while (dirname(dir) !== dir) {
    if (existsSync(resolve(dir, 'tsconfig.json')) || existsSync(resolve(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return from;
}

function resolveModule(importPath: string, indexFile: string): string {
  const projectRoot = projectRootOf(dirname(dirname(indexFile)));
  const base = importPath.startsWith('.')
    ? resolve(dirname(indexFile), importPath)
    : importPath.startsWith('@/')
      ? resolve(projectRoot, importPath.slice(2))
      : null;
  if (!base) throw new Error(`${indexFile}: cannot statically resolve component import ${importPath}`);

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${indexFile}: cannot find component module ${importPath}`);
}

function parseComponentImports(indexSource: string, indexFile: string): Map<string, string> {
  const sourceFile = ts.createSourceFile(indexFile, indexSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.moduleSpecifier.text.startsWith('.') && !statement.moduleSpecifier.text.startsWith('@/')) continue;
    const bindings = statement.importClause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const moduleFile = resolveModule(statement.moduleSpecifier.text, indexFile);
    for (const specifier of bindings.elements) imports.set(specifier.name.text, moduleFile);
  }
  return imports;
}

export function findThemeFieldParityViolations(
  themeSlug: string,
  manifestVariants: ManifestVariants,
  indexSource: string,
  indexFile: string,
): FieldParityViolation[] {
  const implementations = parseVariantImplementations(indexSource, indexFile);
  const imports = parseComponentImports(indexSource, indexFile);
  const violations: FieldParityViolation[] = [];

  for (const [scope, variants] of Object.entries(manifestVariants)) {
    if (!PAGE_BLOCK_SCOPES.has(scope) && !CHROME_SCOPES.has(scope)) continue;
    for (const variant of variants) {
      const variantKey = `${scope}.${variant.id}`;
      const nonPropReads = NON_PROP_VARIANT_READS[variantKey];
      const componentName = implementations[scope]?.[variant.id];

      try {
        const reads = nonPropReads ?? (() => {
          if (!componentName) {
            throw new Error(`${indexFile}: ${variantKey} has no declared non-prop read-set or mapped component`);
          }
          const componentFile = imports.get(componentName);
          if (!componentFile) {
            throw new Error(`${indexFile}: cannot resolve mapped component ${componentName} for ${variantKey}`);
          }
          return extractComponentFieldReads(readFileSync(componentFile, 'utf8'), componentName, componentFile);
        })();
        validateFieldParity(themeSlug, variantKey, Object.keys(variant.fields ?? {}), reads);
      } catch (error) {
        violations.push({
          variant: variantKey,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return violations;
}

export function assertThemeFieldParity(
  themeSlug: string,
  manifestVariants: ManifestVariants,
  indexSource: string,
  indexFile: string,
): void {
  const violations = findThemeFieldParityViolations(themeSlug, manifestVariants, indexSource, indexFile);
  if (violations.length > 0) {
    throw new Error(
      `Theme "${themeSlug}" field parity failed:\n${violations.map(({ variant, reason }) => `- ${variant}: ${reason}`).join('\n')}`,
    );
  }
}
