---
'@usequeek/theme-check': minor
---

Theme → template → design (contract R2.8). A theme is the look, a template is a business it is dressed as, and a design is one concrete store of a template (one demo file).

- New rule `theme/template-designs` (reject). It groups designs by the `template` key each one declares in theme.config.ts, never by an id's `-2` suffix, and checks that:
  - every design names its template with a slug key, never `default`;
  - the main template's key is not also a design id (keys and ids share one namespace);
  - every template has a design 1, the design whose id is its key;
  - a later design repeats its template's `label` and `for` unchanged, or leaves them out and inherits them;
  - every design of a template with two or more designs has a `design_label`, unique within the template and true of any store (the template copy rules);
  - a template has at most three designs.
- `theme/template-versions` keeps its id. It now checks only that no two designs share a home composition.
- `theme/demo-stores` asks for `label` and `for` only on each template's design 1. Its fix for an undeclared file shows `{ id, template, label, for, description }`.
- `theme/template-business` checks each template's `for` once.
- The design resolver is exported (`designsOf`, `groupTemplates`, `mainTemplateKey`, `composeLabel` and their types) and published alone as `@usequeek/theme-check/designs`. It has no dependencies.
- `ThemeContext` gains `themeConfig`. `DeclaredDemo` gains `template` and `design_label`, and its `label` and `for` become optional.
