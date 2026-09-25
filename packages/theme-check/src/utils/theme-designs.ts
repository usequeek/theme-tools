/**
 * Theme → template → design (queek_backend contract R2.8).
 *
 * A theme is the look. A template is a business the theme is dressed as
 * (medley's Food), and a design is one concrete store of it, one demo file:
 * `food` and `food-2` are the Food template's two designs. theme.config.ts
 * declares every design. `default_demo` is the main template's first design
 * (demo.json, id `default`); each `demos[]` entry is one more (demos/<id>.json).
 *
 *   default_demo: { template: 'beauty', label: 'Skincare & make-up', design_label: 'Photo collage', for: [...], description },
 *   demos: [
 *     { id: 'food', template: 'food', label: 'Restaurant & kitchen', design_label: 'Dining room', for: [...], description },
 *     { id: 'food-2', template: 'food', design_label: 'Neighbourhood buka', description },
 *   ],
 *
 * - `template` is the key designs are grouped by, explicit on every design
 *   (never inferred from an id's `-2`): a slug, never `default`, never renamed
 *   once shipped. Template keys and design ids share one namespace.
 * - Design 1 of a template is the design whose id IS its key (`default` in the
 *   main template), so `/medley~food` opens the Food template. The others
 *   follow in `demos[]` order. The index is derived, never declared.
 * - `label` (the business) and `for` belong to the template and are declared
 *   on design 1. A later design may omit them; it inherits design 1's.
 * - `design_label` names a design within its template ("Neighbourhood buka").
 *
 * Tolerant where theme-check is strict: a design without a valid `template` is
 * a template of its own, keyed by its id, and a main design without one has no
 * key (so no gallery). A config written before R2.8 previews and publishes as
 * it did.
 *
 * One resolver for every consumer: the registry, the design index the proxy
 * and the preview read, both copies of theme-check, and theme-cli. So it
 * imports nothing. `yarn tools:sync-lists` copies this file byte for byte to
 * theme-tools (packages/theme-check/src/utils/theme-designs.ts), and a copy
 * that drifts fails `yarn tools:sync-lists --check`. Change it here, then sync.
 */

/** The id `demo.json` goes by: the main template's first design. Equal to theme-demos.ts's PRIMARY_DEMO_ID. */
export const PRIMARY_DESIGN_ID = 'default';
/** Between the theme and the design in a preview segment: `medley~food-2`. Equal to DEMO_SEPARATOR. */
export const DESIGN_SEPARATOR = '~';
/** A design id or a template key: both land in a URL segment and a filename. Equal to DEMO_ID_FORMAT. */
export const DESIGN_ID_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One design as theme.config.ts declares it (`default_demo`, or a `demos[]` entry with its `id`). */
export interface DesignDeclaration {
  /** The key of the template this design belongs to: `food`. */
  template?: string;
  /** The template's label, the business it is dressed as: `Restaurant & kitchen`. Declared on design 1. */
  label?: string;
  /** What tells this design from its template's others: `Neighbourhood buka`. */
  design_label?: string;
  /** The template's business, in lib/storefront/business-vocabulary.json. Declared on design 1. */
  for?: string[];
  /** What an AI reads to choose this design for a merchant (≤ 300 chars). */
  description?: string;
}

/** The part of theme.config.ts this file reads. */
export interface ThemeDesignsConfig {
  /** The theme's name: the main template's label when `default_demo` declares none. */
  name?: string;
  default_demo?: DesignDeclaration;
  demos?: Array<DesignDeclaration & { id: string }>;
}

/** One design, resolved: what the registry publishes for it. */
export interface ThemeDesign {
  /** `default` for demo.json, else the name of its demos/<id>.json. Never renamed once shipped. */
  id: string;
  /** Its template's key. Null only for a main design that declares none (a config written before R2.8). */
  template: string | null;
  /** The template's label (design 1's `label`). */
  templateLabel: string;
  /** 1 for design 1 (the design whose id is the key; `default` in the main template), then `demos[]` order. */
  designIndex: number;
  designLabel: string | null;
  /** For readers that know no templates: see composeLabel. */
  label: string;
  /** The template's business: design 1's `for`, the same on every design of it. */
  for: string[];
  description: string | null;
}

/** A template: its designs, design 1 first. */
export interface ThemeTemplate {
  key: string | null;
  label: string;
  for: string[];
  designs: ThemeDesign[];
}

/** One theme in themes/design-index.json. */
export interface DesignIndexEntry {
  /** The main template's key: `/<slug>~<main>` is demo.json once the theme has a gallery. */
  main: string | null;
  /** The main template first, then in the order the config first names each. */
  templates: DesignIndexTemplate[];
}

export interface DesignIndexTemplate {
  key: string | null;
  label: string;
  /** Design 1 first. `label` is the design's `design_label` (its composed label when it declares none). */
  designs: Array<{ id: string; label: string }>;
}

/** themes/design-index.json: every active theme, by slug. */
export type DesignIndex = Record<string, DesignIndexEntry>;

interface Declared {
  id: string;
  primary: boolean;
  key: string | null;
  label: string | null;
  designLabel: string | null;
  for: string[] | null;
  description: string | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const businessKeys = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const keys = value.filter((key): key is string => typeof key === 'string');
  return keys.length > 0 ? keys : null;
};

/** A declared `template`, or null when it is missing or could not be a key. */
function templateKey(value: unknown): string | null {
  return typeof value === 'string' && DESIGN_ID_FORMAT.test(value) && value !== PRIMARY_DESIGN_ID ? value : null;
}

function declaredDesigns(config: ThemeDesignsConfig | null | undefined): Declared[] {
  const main = config?.default_demo ?? {};
  const designs: Declared[] = [{
    id: PRIMARY_DESIGN_ID,
    primary: true,
    key: templateKey(main.template),
    label: text(main.label),
    designLabel: text(main.design_label),
    for: businessKeys(main.for),
    description: text(main.description),
  }];

  const seen = new Set([PRIMARY_DESIGN_ID]);
  const demos = config?.demos;
  for (const demo of Array.isArray(demos) ? demos : []) {
    // A missing, reserved or repeated id is theme-check's to name; it is no design.
    if (typeof demo?.id !== 'string' || seen.has(demo.id)) continue;
    seen.add(demo.id);
    designs.push({
      id: demo.id,
      primary: false,
      key: templateKey(demo.template) ?? demo.id,
      label: text(demo.label),
      designLabel: text(demo.design_label),
      for: businessKeys(demo.for),
      description: text(demo.description),
    });
  }
  return designs;
}

/**
 * The label a reader that knows no templates shows (the registry's `label`):
 * the template's label when it has one design; `template — design` on every
 * design, design 1 included, when it has more, so two cards never read alike.
 */
export function composeLabel(templateLabel: string, designLabel: string | null, designs: number): string {
  return designs > 1 && designLabel ? `${templateLabel} — ${designLabel}` : templateLabel;
}

/** Every design the config declares, resolved, in declaration order (demo.json first). */
export function designsOf(config: ThemeDesignsConfig | null | undefined): ThemeDesign[] {
  const declared = declaredDesigns(config);
  const groups = new Map<string | null, Declared[]>();
  for (const design of declared) groups.set(design.key, [...(groups.get(design.key) ?? []), design]);

  const resolved = new Map<string, ThemeDesign>();
  for (const [key, members] of groups) {
    const first = members.find((design) => design.primary) ?? members.find((design) => design.id === key) ?? members[0];
    const ordered = [first, ...members.filter((design) => design !== first)];
    const templateLabel = first.label
      ?? (first.primary ? text(config?.name) : null)
      ?? ordered.map((design) => design.label).find((label) => label !== null)
      ?? key
      ?? first.id;
    const templateFor = first.for ?? ordered.map((design) => design.for).find((keys) => keys !== null) ?? [];

    ordered.forEach((design, position) => {
      resolved.set(design.id, {
        id: design.id,
        template: key,
        templateLabel,
        designIndex: position + 1,
        designLabel: design.designLabel,
        // A later design of a template that names no design_label keeps its own
        // label rather than repeating the template's (theme-check rejects it).
        label: ordered.length > 1 && !design.designLabel ? design.label ?? templateLabel : composeLabel(templateLabel, design.designLabel, ordered.length),
        for: [...templateFor],
        description: design.description,
      });
    });
  }

  return declared.map((design) => resolved.get(design.id)!);
}

/** Designs grouped into templates: the main template (demo.json's) first, each template's design 1 first. */
export function groupTemplates(designs: readonly ThemeDesign[]): ThemeTemplate[] {
  const groups = new Map<string | null, ThemeDesign[]>();
  const main = designs.find((design) => design.id === PRIMARY_DESIGN_ID);
  if (main) groups.set(main.template, []);
  for (const design of designs) groups.set(design.template, [...(groups.get(design.template) ?? []), design]);

  return [...groups].map(([key, members]) => {
    const ordered = [...members].sort((a, b) => a.designIndex - b.designIndex);
    return { key, label: ordered[0].templateLabel, for: [...ordered[0].for], designs: ordered };
  });
}

/** The main template's key (`default_demo.template`), or null when it declares none. */
export function mainTemplateKey(config: ThemeDesignsConfig | null | undefined): string | null {
  return templateKey(config?.default_demo?.template);
}

/** The theme's entry in themes/design-index.json. */
export function designIndexEntry(config: ThemeDesignsConfig | null | undefined): DesignIndexEntry {
  return {
    main: mainTemplateKey(config),
    templates: groupTemplates(designsOf(config)).map((template) => ({
      key: template.key,
      label: template.label,
      designs: template.designs.map((design) => ({ id: design.id, label: design.designLabel ?? design.label })),
    })),
  };
}

/**
 * Does `/<slug>` open the template gallery? Only for a theme with two or more
 * templates and a main key to move the main store to (`/<slug>~<main>`). A
 * single-template theme keeps `/<slug>` as its store.
 */
export function hasGallery(theme: { main: string | null; templates: readonly unknown[] }): boolean {
  return theme.main !== null && theme.templates.length >= 2;
}

/**
 * The preview segment of a design: `medley~food-2`. demo.json's is the bare
 * slug, unless the theme has a gallery there: then it is `<slug>~<main key>`.
 */
export function designParam(slug: string, id: string, main: string | null, gallery: boolean): string {
  if (id !== PRIMARY_DESIGN_ID) return `${slug}${DESIGN_SEPARATOR}${id}`;
  return gallery && main !== null ? `${slug}${DESIGN_SEPARATOR}${main}` : slug;
}

/**
 * The design a preview segment's `~<segment>` names, or null for none: the
 * inverse of designParam. The main key is demo.json (`default`) on a gallery
 * theme; any other design id is itself. `default` is never a segment (one URL
 * per design), and a single-template theme's key is none either: its store
 * stays at the bare slug.
 */
export function designOfSegment(theme: DesignIndexEntry, segment: string): string | null {
  if (hasGallery(theme) && segment === theme.main) return PRIMARY_DESIGN_ID;
  if (segment === PRIMARY_DESIGN_ID) return null;
  return theme.templates.some((template) => template.designs.some((design) => design.id === segment)) ? segment : null;
}
