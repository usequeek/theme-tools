import { designsOf, groupTemplates, type ThemeDesignsConfig } from '../../designs';

/** The id `theme/demo.json` goes by: the main template's first design. Every other design is `theme/demos/<id>.json`. */
export const PRIMARY = 'default';

export interface StoreEntry {
  /** The design id: its URL here is `/<id>`. */
  id: string;
  /** Its `design_label`, or its template's label when it declares none. */
  label: string;
  /** Declared in theme.config.ts — an undeclared file is previewable here but rejected on submission. */
  declared: boolean;
}

export interface TemplateEntry {
  /** The template key (`food`); for an undeclared file, its id. Null for a main template that declares none. */
  key: string | null;
  /** The business: `Restaurant & kitchen`. */
  label: string;
  /** Design 1 first. */
  designs: StoreEntry[];
}

/**
 * Every store the theme ships, grouped as Queek groups them (theme → template
 * → design, contract R2.8): by the `template` each design declares, the main
 * template first, each template's design 1 first. `files` are the ids of
 * `theme/demos/*.json`. A declared design with no file is left out (it has
 * nothing to render); a file nobody declared is its own entry, `declared: false`.
 */
export function groupStores(config: ThemeDesignsConfig | null | undefined, files: readonly string[]): TemplateEntry[] {
  const onDisk = new Set([PRIMARY, ...files]);
  const templates: TemplateEntry[] = groupTemplates(designsOf(config)).flatMap((template) => {
    const designs = template.designs
      .filter((design) => onDisk.has(design.id))
      .map((design) => ({ id: design.id, label: design.designLabel ?? design.label, declared: true }));
    return designs.length > 0 ? [{ key: template.key, label: template.label, designs }] : [];
  });

  const declared = new Set(templates.flatMap((template) => template.designs.map((design) => design.id)));
  const undeclared = [...files].filter((id) => !declared.has(id)).sort();
  return [...templates, ...undeclared.map((id) => ({ key: id, label: id, designs: [{ id, label: id, declared: false }] }))];
}
