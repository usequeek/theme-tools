# Queek developer tools

[![CI](https://github.com/usequeek/theme-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/usequeek/theme-tools/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@usequeek/cli.svg)](https://www.npmjs.com/package/@usequeek/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The command-line tools for building on [Queek](https://usequeek.com): storefront themes and
installable apps. This monorepo holds the `queek` CLI, the scaffolders behind
`npm create @usequeek/theme` and `npm create @usequeek/app`, and the rules a theme is checked
against.

- **Themes** are React and CSS. Preview a theme as a whole store, check it against the theme
  contract, and package it for submission. Guides:
  [docs.usequeek.com/docs/themes](https://docs.usequeek.com/docs/themes).
- **Apps** register with Queek through `queek.app.toml`, run against a dev store, and ship as
  versions. Guides: [docs.usequeek.com/docs/apps](https://docs.usequeek.com/docs/apps).

## Packages

| Package | What it is for |
|---|---|
| [`@usequeek/cli`](packages/cli) | The `queek` command. Themes: `queek theme dev`, `screenshot`, `check`, `package`, `info`, `init`. Apps: `queek auth login`, `queek app init`, `dev`, `codegen`, `deploy`, `release`, `submit` and more. |
| [`@usequeek/create-theme`](packages/create-theme) | `npm create @usequeek/theme`: starts a theme from [usequeek/theme-starter](https://github.com/usequeek/theme-starter). |
| [`@usequeek/create-app`](packages/create-app) | `npm create @usequeek/app`: starts an app from [usequeek/queek-app-starter](https://github.com/usequeek/queek-app-starter). |
| [`@usequeek/theme-check`](packages/theme-check) | The rules a theme is checked against, as a library (`checkTheme`, reports, project config). |

Themes build on [`@usequeek/theme-kit`](https://www.npmjs.com/package/@usequeek/theme-kit), the
runtime: data hooks, cart and checkout flows, framework blocks.

## Quick start

Start a theme:

```bash
npm create @usequeek/theme my-theme
cd my-theme
npx queek theme dev      # preview every page of every demo store
npx queek theme check    # check it against the theme contract
```

Start an app:

```bash
npm create @usequeek/app my-app
cd my-app
npx queek auth login
npx queek app dev        # tunnel, dev store and watch
```

Your repository holds only your theme or app; these tools come from npm and update with
`npm update`. Every command has `--help`; the full command reference is the
[CLI README](packages/cli). The theme contract is
[docs/THEME.md in the starter](https://github.com/usequeek/theme-starter/blob/main/docs/THEME.md).

## Development

Requires Node.js 22.14 or later and pnpm (`corepack enable` picks the pinned version).

```bash
pnpm install
pnpm build       # build every package
pnpm test        # public-text check, then the vitest suite
pnpm lint        # eslint over the whole repo
pnpm typecheck   # tsc --noEmit per package (build first)
pnpm publint     # check each built package packs correctly
pnpm e2e         # install the packed tarballs into a fresh project and run the CLI
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repo layout, changesets and release steps.
Report security issues privately — see [SECURITY.md](SECURITY.md). This project follows a
[code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
