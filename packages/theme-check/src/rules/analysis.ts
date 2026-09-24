import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importKit } from '../context.js';
import {
  FRAMEWORK_OWNED_SUBSCRIBE_VARIANTS,
  parseVariantImplementations,
  validateContentFieldContract,
  validateVariantParity,
} from '../parity/variant-parity.js';
import { findThemeFieldParityViolations } from '../parity/field-parity.js';
import { finding, type DesignTokens, type Finding, type Rule, type ThemeContext } from '../types.js';

/**
 * Rules that read the theme's source with the TypeScript compiler rather than
 * rendering it: the manifest against the components, and the design tokens
 * against the CSS.
 */

function indexPath(context: ThemeContext): string | null {
  return ['index.ts', 'index.tsx'].map((name) => join(context.dir, name)).find(existsSync) ?? null;
}

export const variantParityRule: Rule = {
  id: 'theme/variant-parity',
  summary: 'Every manifest variant has a renderer, and vice versa',
  kind: 'render',
  run(context) {
    if (context.retired) return [];
    const path = indexPath(context);
    if (!path || !context.manifest) return [];

    const manifest = context.manifest as unknown as {
      variants: Record<string, Array<{ id: string; fields?: Record<string, unknown> }>>;
      fields_contract?: Partial<Record<string, 'structured'>>;
    };

    try {
      const parsed = parseVariantImplementations(readFileSync(path, 'utf8'), path);
      validateVariantParity(context.slug, manifest.variants, parsed, {
        content: ['default'],
        subscribe: FRAMEWORK_OWNED_SUBSCRIBE_VARIANTS,
      });
      validateContentFieldContract(context.slug, manifest.variants, manifest.fields_contract?.content);
      return [];
    } catch (error) {
      return [finding(context, 'theme/variant-parity', 'reject', {
        where: `${context.env.root}manifest.ts`,
        found: (error as Error).message,
        fix: 'A variant the manifest declares but nothing renders shows a vendor an option that does nothing; a renderer the manifest omits can never be chosen. Both lists must match exactly.',
        docs: `${context.env.docs}#manifest`,
      })];
    }
  },
};

export const fieldParityRule: Rule = {
  id: 'theme/field-parity',
  summary: 'Each variant declares exactly the fields its renderer reads',
  kind: 'render',
  run(context) {
    if (context.retired) return [];
    const path = indexPath(context);
    if (!path || !context.manifest) return [];

    const manifest = context.manifest as unknown as { variants: Record<string, Array<{ id: string; fields?: Record<string, unknown> }>> };

    return findThemeFieldParityViolations(context.slug, manifest.variants, readFileSync(path, 'utf8'), path).map((violation) =>
      finding(context, 'theme/field-parity', 'reject', {
        where: `${context.env.root}manifest.ts`,
        found: `${violation.variant}: ${violation.reason}`,
        fix: 'A declared field the renderer never reads is a control that does nothing when a merchant edits it. A field read but not declared can never be set. Align the manifest with the component.',
        docs: `${context.env.docs}#manifest`,
      }));
  },
};

export const designTokensRule: Rule = {
  id: 'theme/design-tokens',
  summary: 'Declares a complete token set, and its CSS actually consumes it',
  kind: 'render',
  async run(context) {
    if (context.retired) return [];

    const tokens = context.manifest?.tokens;
    const at = `${context.env.root}manifest.ts`;
    const add = (found: string, fix: string, where = at): Finding =>
      finding(context, 'theme/design-tokens', 'reject', { where, found, fix, docs: `${context.env.docs}#manifest` });

    if (!tokens) {
      return [add('no design-token block', 'Declare `tokens` in manifest.ts. Without it a vendor cannot recolour or restyle the theme at all — it is the whole customisation surface.')];
    }

    const findings: Finding[] = [];
    const missing = [
      ['color', tokens.color],
      ['type.heading_font', tokens.type?.heading_font],
      ['type.scale_ratio', tokens.type?.scale_ratio],
      ['space.density', tokens.space?.density],
      ['shape.radius', tokens.shape?.radius],
      ['elevation', tokens.elevation],
      ['motion', tokens.motion],
    ].filter(([, value]) => !value).map(([name]) => name as string);

    if (missing.length > 0) {
      findings.push(add(`tokens missing: ${missing.join(', ')}`, 'Every dimension must be declared — each one is a dial in the vendor’s theme editor.'));
    }

    const { expandDesignTokens } = await importKit<{ expandDesignTokens: (tokens: DesignTokens) => Record<string, string> }>(context.dir, '@usequeek/theme-kit/utils/brand');
    const vars = expandDesignTokens(tokens);
    const unexpanded = ['--brand-primary', '--brand-bg', '--brand-text', '--fs-base', '--fs-3xl', '--space-4', '--radius-md', '--shadow-2', '--duration-base', '--font-heading', '--font-body']
      .filter((key) => !vars[key]);
    if (unexpanded.length > 0) {
      findings.push(add(`tokens do not expand to: ${unexpanded.join(', ')}`, 'Usually a malformed token value. Check it against the starter’s manifest.'));
    }

    const css = context.read('theme.css') ?? '';
    const references = (css.match(/var\(--(fs|space|radius|shadow|duration|fw|tracking|leading|case)-/g) ?? []).length;
    if (references <= 50) {
      findings.push(add(
        `theme.css references design tokens only ${references} time(s)`,
        'Hardcoded sizes and colours mean the vendor’s edits never reach the page. Style from var(--fs-*), var(--space-*), var(--radius-*) and friends.',
        `${context.env.root}theme.css`,
      ));
    }

    return findings;
  },
};

export const ANALYSIS_RULES: Rule[] = [variantParityRule, fieldParityRule, designTokensRule];
