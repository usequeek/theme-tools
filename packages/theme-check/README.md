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

## License

MIT
