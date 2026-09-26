---
'@usequeek/theme-check': minor
'@usequeek/theme-cli': minor
'@usequeek/create-theme': minor
---

Live business vocabulary (R2.9): one resolver in theme-check (`resolveVocabulary`, OS cache dir, conditional GET with `If-None-Match: "<version>"`, cache-then-bundled fallback with a notice), `checkTheme(dir, { vocabulary })` with `check --json` reporting `vocabulary: { source, version }`, a warn-only `theme/template-business` advisory when a template names only `shop`, and `--vocabulary <file>` / `--offline` on `queek-theme check`, `dev`, `package` and `init` plus `npm create @usequeek/theme`. create-theme prompts from the cached-or-bundled copy, refreshes live in the background, revalidates the final `for` against the fresh copy, and lists `shop` last as "General store". Bundled snapshot synced to the R2.9 production vocabulary (version `d1f9c8ee`). Also adds `theme/composition-variants` (reject): every section in every design's pages must name a variant the theme implements (the manifest's declared variants — the registry's `implemented_variants`).
