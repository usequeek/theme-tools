import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';
import { RULES } from '../src/run.js';
import { ANALYSIS_RULES as ANALYSIS_RULES_INTERNAL } from '../src/rules/analysis.js';
import { STATIC_RULES as STATIC_RULES_INTERNAL } from '../src/rules/static.js';

/**
 * Rule-level unit tests (see rules.test.ts) run one rule against a hand-built
 * ThemeContext instead of a whole theme directory through checkTheme(). That
 * needs the per-kind arrays and the individual rule constants on the public
 * API, additive to what checkTheme()/RULES already use internally — this
 * confirms the entry point re-exports the very same objects, not copies.
 */

describe('package entry exports the rule-level surface', () => {
  it('re-exports STATIC_RULES and ANALYSIS_RULES as the same arrays RULES is built from', () => {
    expect(pkg.STATIC_RULES).toBe(STATIC_RULES_INTERNAL);
    expect(pkg.ANALYSIS_RULES).toBe(ANALYSIS_RULES_INTERNAL);
    expect(RULES).toEqual([...pkg.STATIC_RULES, ...pkg.ANALYSIS_RULES]);
  });

  it('re-exports every static rule constant as the same object STATIC_RULES holds, in the same order', () => {
    const exported = [
      pkg.moduleContractRule, pkg.structureRule, pkg.demoStoreRule, pkg.demoStoresRule, pkg.demoArtRule,
      pkg.codeQualityRule, pkg.sdkBoundaryRule, pkg.selectionMetadataRule, pkg.demoCompletenessRule,
      pkg.subscribeScopeRule, pkg.demoBlockTypesRule, pkg.compositionVariantsRule, pkg.identityRule, pkg.productMetafieldsRule,
      pkg.poweredByRule, pkg.fontsSelfHostedRule, pkg.templateDescriptionRule, pkg.templateScreenshotRule,
      pkg.templateChromeRule, pkg.templateStyleRule, pkg.templateBusinessRule, pkg.templateVersionsRule,
      pkg.templateDesignsRule, pkg.templatePagesRule, pkg.templateCopyRule, pkg.vendorFactsRule, pkg.placeholderContentRule,
    ];
    expect(exported).toHaveLength(pkg.STATIC_RULES.length);
    exported.forEach((rule, i) => expect(rule).toBe(pkg.STATIC_RULES[i]));
  });

  it('re-exports every analysis (render-kind) rule constant as the same object ANALYSIS_RULES holds, in the same order', () => {
    const exported = [pkg.variantParityRule, pkg.fieldParityRule, pkg.designTokensRule];
    expect(exported).toHaveLength(pkg.ANALYSIS_RULES.length);
    exported.forEach((rule, i) => expect(rule).toBe(pkg.ANALYSIS_RULES[i]));
  });

  it('exports the design resolver (R2.8) the rules group by, and publishes it alone as ./designs', async () => {
    const designs = await import('../src/utils/theme-designs.js');
    expect(pkg.designsOf).toBe(designs.designsOf);
    expect(pkg.groupTemplates).toBe(designs.groupTemplates);
    expect(pkg.mainTemplateKey).toBe(designs.mainTemplateKey);
    expect(pkg.composeLabel).toBe(designs.composeLabel);
    expect(pkg.TEMPLATE_DESIGNS_MAX).toBe(3);
    const config = { default_demo: { template: 'beauty' }, demos: [{ id: 'food', template: 'food' }, { id: 'food-2', template: 'food' }] };
    expect(pkg.groupTemplates(pkg.designsOf(config)).map((template) => [template.key, template.designs.map((design) => design.id)])).toEqual([
      ['beauty', ['default']],
      ['food', ['food', 'food-2']],
    ]);
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, { default: string }> };
    expect(manifest.exports['./designs'].default).toBe('./dist/utils/theme-designs.js');
  });

  it('exports the frameworkImport helper and the starter placeholder image list used by the static rules', () => {
    expect(pkg.frameworkImport("import Link from 'next/link';")).toBe('next/link');
    expect(pkg.frameworkImport('// not an import')).toBeNull();
    expect(pkg.STARTER_PLACEHOLDER_IMAGES.length).toBeGreaterThan(0);
    // Same list theme/placeholder-content matches against (see rules.test.ts).
    expect(pkg.STARTER_PLACEHOLDER_IMAGES).toContain('https://media.usequeek.com/theme-assets/_bare/0c8749c67b449815.jpg');
  });
});
