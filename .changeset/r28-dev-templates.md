---
'@usequeek/theme-cli': minor
---

`queek-theme dev` lists a theme's stores as theme → template → design (contract R2.8). The index has one section per template (its label and "N designs"), in the order Queek groups them: the main template first, then each template's design 1 first. Each design is listed by its `design_label` and keeps its URL `/<id>`. The hint for an undeclared file shows `{ id, template, label, for, description }`. The grouping comes from the design resolver `@usequeek/theme-check/designs`, which is copied into the preview, so the project never has to resolve theme-check itself. `init`'s `--primary` is described as the main template.
