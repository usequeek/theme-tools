---
"@usequeek/create-theme": patch
---

Fix `renameContent` for real themes: rename CSS custom properties (`--<prefix>-`), data attributes (`data-<prefix>-`), component heads (`MedleyModalLayer` via the display name's PascalCase), and store ids (`<slug>-<id>`); never rewrite inside `https?://` URLs. Preview paths (`/<slug>~<id>`) follow the new slug since the copied demo is the new theme's own store.
