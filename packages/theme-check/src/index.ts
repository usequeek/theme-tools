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
