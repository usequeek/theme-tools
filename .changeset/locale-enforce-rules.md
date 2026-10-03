---
'@usequeek/theme-check': minor
---

`check` warns on the two remaining theme-string holes for one release before rejecting: new `theme/locale-key-exists` (every `t('a.b')` in TS/TSX resolves to the theme's `locales/en.default.json` or the kit core dictionary — a missing key renders empty, never the raw key; dynamic keys are info-only), `theme/locale-key-unused` (info: `en.default.json` keys nothing references) and `theme/no-hardcoded-strings` (shopper-visible JSX text and copy-attribute literals go through `t()`; merchant data, non-copy attributes and brand/unit tokens never flag). All three are warn-first and configurable like other warn-capable rules. Kit core keys ship as a generated snapshot (`src/kit-core-strings.ts`, refreshed with `scripts/sync-kit-core-strings.mjs`; a drift test fails when a resolvable kit dictionary disagrees) instead of a new dependency.
