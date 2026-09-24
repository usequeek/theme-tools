import ts from 'typescript';

/**
 * `subscribe` variants rendered by vendor-shell.tsx itself (theme-agnostic,
 * every theme gets them for free) rather than by a per-theme component in
 * that theme's own `variantImplementations` — see subscribe-{inline,
 * floating,modal}. A theme's OWN bespoke subscribe variant (e.g. glow's
 * `glow-benefits`) is NOT framework-owned; it must appear in that theme's
 * `variantImplementations.subscribe` map instead. One shared list so the
 * registry generator and the parity test can't drift out of sync.
 */
export const FRAMEWORK_OWNED_SUBSCRIBE_VARIANTS = ['inline', 'floating', 'modal'];

export type ParsedVariantImplementations = Record<string, Record<string, string>>;
export type ManifestVariants = Record<string, Array<{ id: string; fields?: Record<string, unknown> }>>;
export type ImplementedVariants = Record<string, string[]>;
export type ContentFieldContract = 'structured' | undefined;

export interface ContentFieldContractReport {
  legacyFieldCount: number;
  structuredFieldCount: number;
}

const MAP_NAME = 'variantImplementations';
const SHAPE_ERROR = `${MAP_NAME} must be a plain nested object literal with component identifier leaves`;
const CONTENT_FIELD_TYPES = new Set([
  'string', 'text', 'markdown', 'image', 'url', 'int', 'number', 'boolean',
  'color', 'string[]', 'image[]', 'object', 'object[]', 'enum',
]);

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function literalPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isDirectlyExported(statement: ts.VariableStatement): boolean {
  return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function shapeError(fileName: string): Error {
  return new Error(`${fileName}: ${SHAPE_ERROR}`);
}

export function parseVariantImplementations(source: string, fileName: string): ParsedVariantImplementations {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | null = null;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !isDirectlyExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === MAP_NAME) {
        initializer = declaration.initializer ?? null;
      }
    }
  }

  if (!initializer) {
    throw new Error(`${fileName}: must directly export const ${MAP_NAME}`);
  }

  const root = unwrapExpression(initializer);
  if (!ts.isObjectLiteralExpression(root)) throw shapeError(fileName);

  const parsed: ParsedVariantImplementations = {};

  for (const scopeProperty of root.properties) {
    if (!ts.isPropertyAssignment(scopeProperty)) throw shapeError(fileName);
    const scope = literalPropertyName(scopeProperty.name);
    const scopeValue = unwrapExpression(scopeProperty.initializer);
    if (!scope || !ts.isObjectLiteralExpression(scopeValue) || parsed[scope]) throw shapeError(fileName);

    const variants: Record<string, string> = {};
    const registeredComponents = new Map<string, string>();

    for (const variantProperty of scopeValue.properties) {
      if (!ts.isPropertyAssignment(variantProperty)) throw shapeError(fileName);
      const variantId = literalPropertyName(variantProperty.name);
      const component = unwrapExpression(variantProperty.initializer);
      if (!variantId || variants[variantId] || !ts.isIdentifier(component)) throw shapeError(fileName);

      const previousVariant = registeredComponents.get(component.text);
      if (previousVariant) {
        throw new Error(
          `${fileName}: ${scope}.${variantId} reuses ${component.text} already registered by ${scope}.${previousVariant}`,
        );
      }

      variants[variantId] = component.text;
      registeredComponents.set(component.text, variantId);
    }

    parsed[scope] = variants;
  }

  return parsed;
}

export function validateVariantParity(
  themeSlug: string,
  manifestVariants: ManifestVariants,
  implementations: ParsedVariantImplementations,
  frameworkOwned: Record<string, string[]>,
): ImplementedVariants {
  const manifestKeys = new Set<string>();

  for (const [scope, variants] of Object.entries(manifestVariants)) {
    const ids = new Set<string>();
    for (const variant of variants) {
      if (ids.has(variant.id)) {
        throw new Error(`Theme "${themeSlug}" manifest has duplicate variant id ${scope}.${variant.id}`);
      }
      ids.add(variant.id);
      manifestKeys.add(`${scope}.${variant.id}`);
    }
  }

  const implementedKeys = new Set<string>();
  for (const [scope, variants] of Object.entries(implementations)) {
    for (const id of Object.keys(variants)) implementedKeys.add(`${scope}.${id}`);
  }
  for (const [scope, ids] of Object.entries(frameworkOwned)) {
    const declaredIds = new Set(manifestVariants[scope]?.map((variant) => variant.id) ?? []);
    for (const id of ids) {
      if (declaredIds.has(id)) implementedKeys.add(`${scope}.${id}`);
    }
  }

  const manifestOnly = [...manifestKeys].filter((key) => !implementedKeys.has(key)).sort();
  const implementationOnly = [...implementedKeys].filter((key) => !manifestKeys.has(key)).sort();

  if (manifestOnly.length > 0 || implementationOnly.length > 0) {
    throw new Error(
      `Theme "${themeSlug}" variant parity failed: manifest-only [${manifestOnly.join(', ')}]; implementation-only [${implementationOnly.join(', ')}]`,
    );
  }

  const evidence: ImplementedVariants = {};
  for (const scope of Object.keys(manifestVariants).sort()) {
    evidence[scope] = manifestVariants[scope].map((variant) => variant.id).sort();
  }
  return evidence;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateStructuredContentField(
  value: Record<string, unknown>,
  path: string,
): number {
  if (typeof value.type !== 'string' || !CONTENT_FIELD_TYPES.has(value.type)) {
    throw new Error(`${path} has unknown type "${String(value.type)}"`);
  }

  if (value.type === 'enum' && (!Array.isArray(value.options) || value.options.length === 0 || value.options.some((option) => typeof option !== 'string'))) {
    throw new Error(`${path} enum fields require non-empty options`);
  }

  if (value.type === 'object[]') {
    if (!isPlainObject(value.of) || Object.keys(value.of).length === 0) {
      throw new Error(`${path} object[] fields require an of object`);
    }

    return 1 + Object.entries(value.of).reduce((count, [key, nested]) => {
      if (!isPlainObject(nested)) {
        throw new Error(`${path}.of.${key} must be a structured field object`);
      }
      return count + validateStructuredContentField(nested, `${path}.of.${key}`);
    }, 0);
  }

  return 1;
}

/**
 * Checks the content-field migration independently of runtime variant parity.
 * Legacy strings remain accepted until a theme sets `content_fields: 'structured'`.
 */
export function validateContentFieldContract(
  themeSlug: string,
  manifestVariants: ManifestVariants,
  contract: ContentFieldContract = undefined,
): ContentFieldContractReport {
  let legacyFieldCount = 0;
  let structuredFieldCount = 0;

  for (const variant of manifestVariants.content ?? []) {
    for (const [fieldName, field] of Object.entries(variant.fields ?? {})) {
      const path = `content.${variant.id}.${fieldName}`;
      if (typeof field === 'string') {
        if (contract === 'structured') {
          throw new Error(`Theme "${themeSlug}" content fields are marked structured but ${path} is still legacy`);
        }
        legacyFieldCount += 1;
        continue;
      }
      if (!isPlainObject(field)) {
        throw new Error(`Theme "${themeSlug}" ${path} must be a legacy string or structured field object`);
      }
      structuredFieldCount += validateStructuredContentField(field, path);
    }
  }

  return { legacyFieldCount, structuredFieldCount };
}
