---
'@usequeek/cli': minor
'@usequeek/create-theme': minor
---

`queek theme add template|design|page`: grow a theme after scaffolding — a template (new demo store from the bundled skeleton, declared in theme.config.ts), a second or third design of a template, and the contact/faq page on a design's store. Config edits go through the AST (magicast), every prompt has a flag, `--dry-run` writes nothing, `--json` prints `{ added, files }`.
