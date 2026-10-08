import { designsOf, groupTemplates } from '../../designs';
/** The id `theme/demo.json` goes by: the main template's first design. Every other design is `theme/demos/<id>.json`. */
export const PRIMARY = 'default';
/**
 * Every store the theme ships, grouped as Queek groups them (theme → template
 * → design): by the `template` each design declares, the main
 * template first, each template's design 1 first. `files` are the ids of
 * `theme/demos/*.json`. A declared design with no file is left out (it has
 * nothing to render); a file nobody declared is its own entry, `declared: false`.
 */
export function groupStores(config, files) {
    const onDisk = new Set([PRIMARY, ...files]);
    const templates = groupTemplates(designsOf(config)).flatMap((template) => {
        const designs = template.designs
            .filter((design) => onDisk.has(design.id))
            .map((design) => ({ id: design.id, label: design.designLabel ?? design.label, declared: true }));
        return designs.length > 0 ? [{ key: template.key, label: template.label, designs }] : [];
    });
    const declared = new Set(templates.flatMap((template) => template.designs.map((design) => design.id)));
    const undeclared = [...files].filter((id) => !declared.has(id)).sort();
    return [...templates, ...undeclared.map((id) => ({ key: id, label: id, designs: [{ id, label: id, declared: false }] }))];
}
