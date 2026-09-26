---
'@usequeek/theme-check': patch
---

theme/core-boundary also rejects app-code imports and folder escapes: any `@/`-aliased specifier, and any relative import resolving outside the theme's own folder. Both only ever resolved inside the storefront repo and broke everywhere else a theme runs.
