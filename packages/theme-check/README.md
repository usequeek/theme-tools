# @usequeek/theme-check

The rules a [Queek](https://usequeek.com) storefront theme is checked against, as a library.
Most people want the command line instead: `npx queek-theme check` from
[`@usequeek/theme-cli`](https://www.npmjs.com/package/@usequeek/theme-cli).

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

New rules: `theme/markdown-html` (reject) — `renderMarkdown` returns React elements, not an
HTML string, so passing it to `dangerouslySetInnerHTML` renders "[object Object]";
`theme/disable-comment` (warn) — a disable comment names a rule that does not exist.

## Project config

`loadProjectConfig(root)` reads `.queek-theme.yml` at the project root (`null` when there
is no file; `ConfigError` when invalid), and `applyProjectConfig(findings, config)` applies
it. The config changes warnings only. Errors are the contract Queek checks when you submit,
so nothing turns them off. If an error is wrong for your theme, open an issue:
https://github.com/usequeek/theme-tools/issues

`rules.<id>` is `off` (drop that rule's warnings), `warning` (the default) or `error` (turn
them into rejects); `ignore` globs, relative to the project root, drop warnings in those
files. Reject findings are never changed. `checkTheme()` never reads the config.

## Inline disable comments

`applyDisableComments(findings, themeDir)` drops warn findings covered by a
`queek-theme-disable-next-line` comment (`//` in `.ts`/`.tsx`, `/* */` in `.css`) on the
line above, and adds a `theme/disable-comment` warning for unknown rule ids.

## Machine-readable report

`jsonReport(result)` builds the object `formatJson(result)` prints (same bytes):
`{ theme, summary, vocabulary, findings, atSubmission }`.

## License

MIT
