# @usequeek/theme-cli

`queek-theme` — preview, check and package themes for [Queek](https://usequeek.com) storefronts.

```bash
npm install --save-dev @usequeek/theme-cli
```

New theme? Start with `npm create @usequeek/theme my-theme`; it installs this for you.

Requires Node.js 22.12 or later, and in your project: `@usequeek/theme-kit`, `next` 16,
`react` and `react-dom` 19.

## Commands

### `queek-theme dev`

Previews the theme as a whole store: every page of every design (demo store) — `theme/demo.json`,
the main template's first design, at `/default`, each `theme/demos/<id>.json` at `/<id>` —
rendered by real Next.js with the composition a live storefront uses. The index page lists them by
template, the way `theme.config.ts` groups them (its `template` key on every design), each with
its `design_label`. Edits reload the page.

| Flag | Default | |
|---|---|---|
| `--path <dir>` | `.` | The theme project, or its theme folder. |
| `--port <n>` | `3000` | |
| `--host <host>` | `127.0.0.1` | `0.0.0.0` to reach it from another device. |

The preview app is generated in `.queek/preview` on every run and ignores itself for git.

### `queek-theme check`

Checks the theme against the [theme contract](https://github.com/usequeek/theme-starter/blob/main/docs/THEME.md)
— the rules Queek runs when you submit, except the few that need Queek's side, which the report
lists. Every finding has a rule id, the file, what to do, and a link to the contract.

| Flag | Default | |
|---|---|---|
| `--path <dir>` | `.` | |
| `--format <stylish\|json\|github-actions>` | `stylish` | `json` is one stable object on stdout; `github-actions` annotates a pull request. |
| `--json` | | Print the same report object as `--format json` (the command returns it). Exit codes unchanged. |
| `--fail-level <error\|warning>` | `error` | Lowest level that exits 1. |
| `--quiet` | | Errors only. |
| `--verbose` | | Debug lines on stderr (also `QUEEK_THEME_VERBOSE=true`). |
| `--init` | | Write a starter `.queek-theme.yml` in the project and exit; refuses if one exists. |

Exit codes: **0** no findings at the fail level · **1** findings at or above it · **2** the
check could not run.

In GitHub Actions:

```yaml
- run: npx queek-theme check --format github-actions
```

### `queek-theme package`

Writes `<slug>.zip` with the theme folder (never `node_modules`, `.queek` or `.git`) for
submission, and warns if errors would block it. `--output <file>` to choose where.
`--json` returns `{ theme, file, bytes, sha256, errors, warnings }` instead of the
human line; `--verbose` debugs on stderr like `check`.

## Project config (`.queek-theme.yml`)

`check` and `package` read `.queek-theme.yml` at the project root (beside `package.json`);
`queek-theme check --init` writes a starter. The config changes warnings only. Errors are
the contract Queek checks when you submit, so nothing turns them off. If an error is wrong
for your theme, open an issue: https://github.com/usequeek/theme-tools/issues

```yaml
rules:
  theme/template-business: off     # off | warning | error
ignore:
  - theme/vendor/**                # warnings in these files are not reported
```

`off` drops a rule's warnings; `error` turns them into errors (a stricter CI); `warning` is
the default. `ignore` globs (relative to the project root) drop warnings in those files.
A rule's errors are never changed. An invalid file exits 2, naming the file and the key.
When a config is in effect, `check` says so on stderr
(`Using .queek-theme.yml (2 rules changed, 1 ignore pattern).`).

### `queek-theme init [dir]`

The same as `npm create @usequeek/theme [dir]`, with the same flags; see
[create-theme's README](https://github.com/usequeek/theme-tools/tree/main/packages/create-theme#usage). In a terminal, anything you leave out is
asked; with `--yes` or without a terminal, nothing is, and `--templates` and `--tags` are
required. With no `dir`, the folder is named after the theme in a terminal, `my-theme`
otherwise.

| Flag | |
|---|---|
| `--name <text>` | Theme name (default: the folder name). |
| `--templates <keys>` | Businesses to make templates for, comma-separated (required with `--yes`). |
| `--primary <key>` | The main template (default: the first). |
| `--categories <keys>` | Business categories (default: the templates'). |
| `--tags <tags>` | 1–6 tags for the look (required with `--yes`). |
| `--pages <list\|none>` | Extra pages: `contact`, `faq` (default: both). |
| `--ai <list>`, `--no-ai` | AI assistants: `claude`, `gemini` (default: both; AGENTS.md unless `--no-ai`). |
| `--pm <npm\|pnpm\|yarn\|bun>` | The package manager to install with. |
| `--no-install`, `--no-git` | Skip installing, or `git init`. |
| `--yes`, `-y` | Never prompt; take the default for everything else. |
| `--dry-run` | Print what would be written; write nothing. |
| `--force` | Allow a folder that is not empty. |
| `--template <source>` | Another starter: a giget source or a local folder. |

## New rule

- `theme/markdown-html` (error): `renderMarkdown` returns React elements, not an HTML
  string — passing it to `dangerouslySetInnerHTML` renders "[object Object]". Render the
  elements as children, or use `<Markdown>` from `@usequeek/theme-kit/components/markdown`.

## Environment

- Every flag of `dev` and `check` has a `QUEEK_THEME_*` variable (`QUEEK_THEME_PORT`, …),
  including `QUEEK_THEME_VERBOSE` for `--verbose`.
- `NO_COLOR` turns colour off; output is plain when not a terminal.
- Once a day the CLI mentions a newer version; `QUEEK_THEME_SKIP_NEW_VERSION_CHECK=true` turns
  that off. It never checks in CI (`CI` set to anything but `''`/`'false'`/`'0'`), nor when
  `QUEEK_THEME_NO_UPDATE_CHECK` is set likewise.
- It collects no usage data.

## License

MIT
