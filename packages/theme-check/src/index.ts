/**
 * @usequeek/theme-check — the rules a Queek storefront theme is checked
 * against, as a library. The `queek-theme check` command of
 * @usequeek/theme-cli is its command-line front end.
 */
export { checkTheme, rejects, RULES, AT_SUBMISSION, type CheckOptions, type CheckResult } from './run.js';
export { loadContext, localEnv, CONTRACT_URL } from './context.js';
export { formatJson, formatGithubActions, formatStylish, summarize, levelOf, fileOf, type Level, type Summary } from './format.js';
export type { CheckEnv, Finding, Rule, Severity, ThemeContext, DemoStore, DeclaredDemo } from './types.js';
export { BUSINESS_KEYS, SERVICE_SLUGS, CATALOGUE, SUBCATEGORIES, isBusinessKey, businessRoot } from './utils/business-vocabulary.js';
export { TEMPLATE_COPY_PLACES, copyViolations, isTestimonialSection, storeNameForms } from './utils/template-copy.js';
export { PRIMARY_DEMO_ID, DEMO_ID_FORMAT, demoFilesOf } from './utils/theme-demos.js';
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
  templatePagesRule,
  templateCopyRule,
  vendorFactsRule,
  placeholderContentRule,
  frameworkImport,
  STARTER_PLACEHOLDER_IMAGES,
} from './rules/static.js';
export { ANALYSIS_RULES, variantParityRule, fieldParityRule, designTokensRule } from './rules/analysis.js';
