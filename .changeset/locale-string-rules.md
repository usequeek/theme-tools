---
'@usequeek/theme-check': minor
---

`check` warns on theme string files for one release before rejecting: new `theme/locale-key-naming` (dotted-lowercase keys ≤40 chars, string-or-plural values ≤1000 chars, no HTML/empties, ≤3400 keys per file) and `theme/locale-file-parity` (`en.default.json` is the fallback authority; extra keys and undeclared `{variables}` warn). Both are configurable like other warn-capable rules. Ships the shared `allowlist/brand-names.json` the enforce slice will reuse.
