/**
 * One definition of "is this theme valid", shared by three consumers: the
 * author's `yarn theme:check`, this repo's CI, and (later) the pull/publish
 * command. The moment validity has two implementations they drift, and an
 * author gets a green locally and a rejection here.
 *
 * Rules therefore live in this library and the tests assert over it — not the
 * other way round, which is where five of these gates started.
 */

/**
 * The parts of a theme's manifest (and of @usequeek/theme-kit's ThemeManifest)
 * the rules read. Structural, so this package does not compile the kit's
 * source — the kit ships TypeScript, not declarations.
 */
export interface ThemeManifest {
  slug?: string;
  variants?: Record<string, unknown[]>;
  tokens?: DesignTokens;
  [key: string]: unknown;
}

/** The design-token dimensions the design-tokens rule requires (the kit's DesignTokens). */
export interface DesignTokens {
  color?: Record<string, unknown>;
  type?: { heading_font?: string; body_font?: string; scale_ratio?: number; [key: string]: unknown };
  space?: { density?: string; [key: string]: unknown };
  shape?: { radius?: string; [key: string]: unknown };
  elevation?: string;
  motion?: string;
  [key: string]: unknown;
}

/** `reject` blocks publication. `warn` is advice a theme can ship with. */

export type Severity = 'reject' | 'warn';

export interface Finding {
  /** Stable id — an agent keys its fix loop on this, so never rename casually. */
  rule: string;
  severity: Severity;
  theme: string;
  /** `path/in/theme.tsx:line` where known. */
  where?: string;
  /** What is actually there. */
  found: string;
  /** What to do about it, concretely enough to act on without reading docs. */
  fix: string;
  /** True when `--fix` can resolve it without a human decision. */
  fixable?: boolean;
  docs?: string;
}

/** One demo store on disk: `demo.json` (id `default`) or `demos/<id>.json`. */
export interface DemoStore {
  id: string;
  /** Relative to the theme directory. */
  file: string;
  /** Null when the file is missing or not valid JSON. */
  data: Record<string, unknown> | null;
}

/** A `demos[]` entry in theme.config.ts. */
export interface DeclaredDemo {
  id: string;
  label: string;
  /** Business slugs (the vendor's service_slug/service_type vocabulary). */
  for: string[];
  /** What an AI reads to choose this template for a merchant (≤ 300 chars). */
  description?: string;
}

/**
 * Where the rules are running, so every finding names things the reader can
 * act on. A developer's repo and Queek's submission pipeline see the same
 * theme through different paths and commands; the rules are the same.
 */
export interface CheckEnv {
  /** How a file of the theme is written in a finding, e.g. `theme/` — always ends with `/`. */
  root: string;
  /** The contract, as a URL (findings link `<docs>#<section>`). */
  docs: string;
  /** Where the business vocabulary is, as the reader would find it. */
  vocabulary: string;
  /** The command that scaffolds a complete theme. */
  scaffold: string;
  /** Where a template previews, by template id (`default` is the primary). */
  preview: (templateId: string) => string;
  /**
   * True when Queek is checking a submission. Two checks only mean anything
   * then: demo art on Queek's CDN, and screenshots uploaded — both done by the
   * submission pipeline itself, never by the developer.
   */
  submission: boolean;
}

export interface ThemeContext {
  env: CheckEnv;
  slug: string;
  dir: string;
  /** `active: false` in theme.config.ts — retired, exempt from publish gates. */
  retired: boolean;
  /** The primary store — `demos[0].data`. Kept for rules that only ever read it. */
  demo: Record<string, unknown> | null;
  /** Every store on disk, the primary first. */
  demos: DemoStore[];
  /** `demos` from theme.config.ts; null when the config could not be loaded. */
  declaredDemos: DeclaredDemo[] | null;
  /** `default_demo.description` from theme.config.ts — the primary template's description. */
  defaultDescription: string | null;
  /** `default_demo.for` from theme.config.ts, unvalidated — the primary template's business. */
  defaultFor: unknown;
  manifest: ThemeManifest | null;
  /** Declares page-block variants, so the page-based structure applies. */
  pageBased: boolean;
  file: (relative: string) => string;
  exists: (relative: string) => boolean;
  read: (relative: string) => string | null;
}

export interface Rule {
  id: string;
  /** One line, shown by `--list`. */
  summary: string;
  /** Render rules import theme modules and are slow — `--static` skips them. */
  kind: 'static' | 'render';
  run: (context: ThemeContext) => Finding[] | Promise<Finding[]>;
}

export function finding(
  context: ThemeContext,
  rule: string,
  severity: Severity,
  parts: Omit<Finding, 'rule' | 'severity' | 'theme'>,
): Finding {
  return { rule, severity, theme: context.slug, ...parts };
}
