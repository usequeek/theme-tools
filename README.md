# Queek theme tools

[![CI](https://github.com/usequeek/theme-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/usequeek/theme-tools/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@usequeek/theme-cli.svg)](https://www.npmjs.com/package/@usequeek/theme-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Tools for building themes for [Queek](https://usequeek.com) storefronts: preview a theme as a
whole store, check it against the theme contract, and package it for submission.

```bash
npm create @usequeek/theme my-theme
cd my-theme
npm run dev        # preview every page of every demo store at http://localhost:3000
npm run check      # check it against the Queek theme contract
```

A theme is React and CSS. Your repository holds only your theme; these tools come from npm and
update with `npm update`, never touching your files.

## Packages

| Package | What it is |
|---|---|
| [`@usequeek/theme-cli`](packages/theme-cli) | The `queek-theme` command: `dev`, `check`, `package`, `init`. |
| [`@usequeek/create-theme`](packages/create-theme) | `npm create @usequeek/theme` — starts a theme from [usequeek/theme-starter](https://github.com/usequeek/theme-starter). |
| [`@usequeek/theme-check`](packages/theme-check) | The rules a theme is checked against, as a library. |

Themes build on [`@usequeek/theme-kit`](https://www.npmjs.com/package/@usequeek/theme-kit), the
runtime: data hooks, cart and checkout flows, framework blocks.

## Documentation

- The theme contract: [docs/THEME.md in the starter](https://github.com/usequeek/theme-starter/blob/main/docs/THEME.md)
- Each command: `npx queek-theme <command> --help`, and the [CLI README](packages/theme-cli)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately — see
[SECURITY.md](SECURITY.md). This project follows a [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
