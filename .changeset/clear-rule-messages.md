---
"@usequeek/theme-check": patch
"@usequeek/cli": patch
---

Clearer check messages, and three rule fixes.

- `theme/code-quality` accepts `"use client"` in double quotes, after a leading comment or a byte-order mark. It no longer rejects those files, and its message names the file and the fix.
- `theme/core-boundary` now catches an SDK import written with double quotes.
- `theme/demo-completeness` links to the Homepage Requirement section of the theme contract (the old link pointed at a heading that no longer exists).
- Locale and design-token messages say what limit applies and why, in plain words. The design-token message states its threshold.
- `queek theme check --path` with a missing folder says what to do next. The `queek app dev` help is rewritten as steps, and the `[dev]` example matches the app starter.
