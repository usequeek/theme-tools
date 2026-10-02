# @usequeek/theme-check

The rules a [Queek](https://usequeek.com) storefront theme is checked against, as a library.
Most people want the command line instead: `npx queek theme check` from
[`@usequeek/cli`](https://www.npmjs.com/package/@usequeek/cli).

```bash
npm install --save-dev @usequeek/theme-check
```

```ts
import { checkTheme, formatStylish, rejects } from '@usequeek/theme-check';

const result = await checkTheme('theme');          // the folder with manifest.ts
console.log(formatStylish(result, { color: true }));
process.exitCode = rejects(result.findings).length > 0 ? 1 : 0;
```

Each finding: `rule` (a stable id), `severity` (`reject` blocks submission, `warn` is advice),
`where`, `found`, `fix` and `docs` (a link into the
[theme contract](https://github.com/usequeek/theme-starter/blob/main/docs/THEME.md)).
`AT_SUBMISSION` lists the checks only Queek can run — against its other themes, with a server
render, or on its storage.

Theme modules (`theme.config.ts`, `manifest.ts`) load through jiti from the theme's own
project, so the project must have `@usequeek/theme-kit` installed.

New rule: `theme/markdown-html` (reject) — `renderMarkdown` returns React elements, not an
HTML string, so passing it to `dangerouslySetInnerHTML` renders "[object Object]".
New rules (warn one release, then reject): `theme/locale-key-naming` — every key in
`locales/*.json` is dotted lowercase `scope.thing.state` (≤40 chars so `<slug>.<key>` fits
varchar(64), no hyphens), values are strings or plural maps (≤1000 chars, no raw HTML, no
empties), at most 3400 keys per file; `theme/locale-file-parity` — every `locales/{lang}.json`
key exists in `en.default.json` (English is the fallback authority) and its `{variables}` stay
a subset of the English ones. Brand tokens that may stay untranslated live in
`src/allowlist/brand-names.json`.
New rules (warn one release, then reject): `theme/locale-key-exists` — every `t('a.b')`
call in TS/TSX (through `t`, `*.t`, or an alias bound to `useThemeStrings()` /
`createThemeStrings()` / `getThemeStrings()`, e.g. `const ts = …` or
`const { t: translate } = …`) resolves to the theme's own `locales/en.default.json` or
the kit core dictionary (a missing key renders EMPTY, never the raw key); dynamic keys are
info-only. Limitation: a bound `t` handed to another file's helper under a different
parameter name is not followed. `theme/locale-key-unused` (info) — `en.default.json` keys
nothing references are dead copy. `theme/no-hardcoded-strings` — shopper-visible JSX text
and copy-attribute literals (`aria-label`, `aria-description`, `placeholder`, `title`, `alt`,
`label`, plus the audited `actionLabel`/`moreLabel`) go through `t()`, not hard-coded.
Merchant data (`{product.title}`), non-copy attributes, brand/unit tokens and strings
already inside `t()` never flag. Kit core keys come from the generated snapshot in
`src/kit-core-strings.ts` (no new dependency — regenerate with
`scripts/sync-kit-core-strings.mjs`, which also refreshes the committed copy at
`test/fixtures/kit-en.default.json` that the drift test compares, including in CI via
`KIT_DICTIONARY_PATH`), layered over the theme project's own installed kit dictionary
when readable.

## Project config

`loadProjectConfig(root)` reads `.queek-theme.yml` at the project root (`null` when there
is no file; `ConfigError` when invalid), and `applyProjectConfig(findings, config)` applies
it. The config changes warnings only. Errors are the contract Queek checks when you submit,
so nothing turns them off. If an error is wrong for your theme, open an issue:
https://github.com/usequeek/theme-tools/issues

`rules.<id>` is `off` (drop that rule's warnings), `warning` (the default) or `error` (turn
them into rejects); `ignore` globs, relative to the project root, drop warnings in those
files. Reject findings are never changed. `checkTheme()` never reads the config.

## Machine-readable report

`jsonReport(result)` builds the object `formatJson(result)` prints (same bytes):
`{ theme, summary, vocabulary, findings, atSubmission }`.

## License

MIT
