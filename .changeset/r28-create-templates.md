---
'@usequeek/create-theme': minor
---

Creates themes as theme → template → design (contract R2.8). Each business picked becomes a template with one design, and `theme.config.ts` declares `template` on every design: the business key picked, on `default_demo` for the main template (`--primary`) and on each `demos[]` entry, whose id is its key. So the new `theme/template-designs` check passes on a fresh theme. A template is never inferred from an id, and no `<key>-2` ids are written. `TemplatePlan` gains `template`. The prompt asks "Which template is the main one?"; the flag stays `--primary`.
