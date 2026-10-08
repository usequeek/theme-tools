/**
 * @usequeek/theme-check — the rules a Queek storefront theme is checked
 * against, as a library. The `queek theme check` command of
 * @usequeek/cli is its command-line front end.
 */
export { checkTheme, rejects, RULES, AT_SUBMISSION, type CheckOptions, type CheckResult, type CheckVocabulary } from './run.js';
export {
  resolveVocabulary, vocabularyCacheDir, readCachedVocabulary, bundledVocabulary, bundledVersion,
  parseEndpointPayload, parseVocabularyData, VOCABULARY_URL, VOCABULARY_CACHE_TTL_MS,
  type BusinessVocabularyData, type ResolveVocabularyOptions, type ResolvedVocabulary, type VocabularySource,
} from './vocabulary.js';
export { loadContext, localEnv, CONTRACT_URL } from './context.js';
export { formatJson, formatGithubActions, formatStylish, summarize, levelOf, fileOf, jsonReport, type JsonFinding, type JsonReport, type Level, type Summary } from './format.js';
export {
  loadProjectConfig, applyProjectConfig, warningRuleIds, renderInitConfig,
  CONFIG_FILE_NAME, CONFIG_POLICY, ConfigError,
  type ConfigRuleLevel, type ProjectConfig,
} from './config.js';
export { editDistance, closestRuleId } from './utils/closest-id.js';
export type { CheckEnv, Finding, Rule, Severity, ThemeContext, DemoStore, DeclaredDemo } from './types.js';
export { BUSINESS_KEYS, SERVICE_SLUGS, CATALOGUE, SUBCATEGORIES, ROOT_SERVICE, BUNDLED_VERSION, bundledVocabularyView, vocabularyViewOf, isBusinessKey, businessRoot, type VocabularyView } from './utils/business-vocabulary.js';
export { TEMPLATE_COPY_PLACES, TEMPLATE_COPY_CLAIMS, TEMPLATE_COPY_SCHEDULES, copyViolations, isTestimonialSection, storeNameForms, type CopyScope } from './utils/template-copy.js';
export { PRIMARY_DEMO_ID, DEMO_ID_FORMAT, demoFilesOf } from './utils/theme-demos.js';
// Theme → template → design: the resolver the registry, the
// preview and these rules share. Also published alone as `@usequeek/theme-check/designs`.
export {
  designsOf,
  groupTemplates,
  mainTemplateKey,
  composeLabel,
  type DesignDeclaration,
  type ThemeDesignsConfig,
  type ThemeDesign,
  type ThemeTemplate,
} from './utils/theme-designs.js';
export { TEMPLATE_DESCRIPTION_MAX, screenshotFile, sectionStyle, sectionCopy, declaredFieldsByVariant } from './utils/theme-templates.js';

// Per-kind rule arrays and the individual rule constants, for rule-level unit
// tests that want to run one rule against a hand-built ThemeContext instead
// of a whole theme directory through checkTheme().
export {
  STATIC_RULES,
  moduleContractRule,
  structureRule,
  demoStoreRule,
  demoStoresRule,
  demoArtRule,
  codeQualityRule,
  sdkBoundaryRule,
  selectionMetadataRule,
  demoCompletenessRule,
  subscribeScopeRule,
  demoBlockTypesRule,
  compositionVariantsRule,
  identityRule,
  productMetafieldsRule,
  poweredByRule,
  fontsSelfHostedRule,
  templateDescriptionRule,
  templateScreenshotRule,
  templateChromeRule,
  templateStyleRule,
  templateBusinessRule,
  templateVersionsRule,
  templateDesignsRule,
  TEMPLATE_DESIGNS_MAX,
  templatePagesRule,
  templateCopyRule,
  vendorFactsRule,
  placeholderContentRule,
  markdownHtmlRule,
  frameworkImport,
  moduleSpecifiers,
  STARTER_PLACEHOLDER_IMAGES,
} from './rules/static.js';
export { ANALYSIS_RULES, variantParityRule, fieldParityRule, designTokensRule } from './rules/analysis.js';
// Theme string files: naming/shape and file-parity rules, plus the shared
// helpers (locale budgets, brand allowlist) the enforcement rules reuse.
export { localeKeyNamingRule, localeFileParityRule, localeInterpolationVars } from './rules/locale-strings.js';
export { LOCALE_ENFORCE_RULES, localeKeyExistsRule, localeKeyUnusedRule, noHardcodedStringsRule } from './rules/locale-enforce.js';
export { KIT_CORE_KEYS, KIT_CORE_SOURCE, kitCoreKeysFor } from './kit-core-strings.js';
export {
  LOCALE_KEY_PATTERN,
  LOCALE_KEY_MAX_LENGTH,
  LOCALE_VALUE_MAX_LENGTH,
  LOCALE_FILE_MAX_KEYS,
  LOCALE_LIMITS_DOC_URL,
  THEME_SLUG_MAX_LENGTH,
  THEME_SLUG_PATTERN,
  PLURAL_FORMS,
  LOCALE_CODE_PATTERN,
  LOCALE_CODE_MAX_LENGTH,
  DEFAULT_LOCALE_FILE,
  flattenLocaleEntries,
  hasRawHtml,
  extractInterpolationVars,
  leafInterpolationVars,
  isPluralMapShape,
  localeCodeOfFile,
  type LocaleLeaf,
  type LocaleConflict,
  type PluralForm,
} from './utils/locale-files.js';
export { BRAND_NAMES, isBrandNameToken } from './allowlist/brand-names.js';
