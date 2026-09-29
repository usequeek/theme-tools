# @usequeek/cli

The Queek developer CLI: build, preview, check and package themes for
[Queek](https://usequeek.com) storefronts — and build installable apps
(`queek auth login`, `queek app …`).

```bash
npm install --save-dev @usequeek/cli
```

New theme? Start with `npm create @usequeek/theme my-theme`; it installs this for you.
New app? Start with `npm create @usequeek/app my-app` (== `queek app init`).

Guides: [docs.usequeek.com/docs/themes](https://docs.usequeek.com/docs/themes).

Requires Node.js 22.12 or later, and in your project: `@usequeek/theme-kit`, `next` 16,
`react` and `react-dom` 19.

## Commands

### `queek theme dev`

Previews the theme as a whole store: every page of every design (demo store) — `theme/demo.json`,
the main template's first design, at `/default`, each `theme/demos/<id>.json` at `/<id>` —
rendered by real Next.js with the composition a live storefront uses. The index page lists them by
template, the way `theme.config.ts` groups them (its `template` key on every design), each with
its `design_label`. Edits reload the page.

```bash
queek theme dev --port 4000
```

| Flag | Default | |
|---|---|---|
| `--path <dir>` | `.` | The theme project, or its theme folder. |
| `--port <n>` | `7833, or the next free port` | A given port is strict: when it is busy the command exits 2. Without `--port` (and without `QUEEK_THEME_PORT`) the first free port in 7833–7852 is used, probed before the preview builds. |
| `--host <host>` | `127.0.0.1` | `0.0.0.0` to reach it from another device. |

The preview app is generated in `.queek/preview` on every run and ignores itself for git.

### `queek theme screenshot [designs…]`

Captures every design's first screen at 1280×800 into the files the checker reads:
`theme/theme.jpg` for the primary design (`theme.png` when only a png exists there),
`theme/demos/<id>.jpg` for the rest. Pass design ids to capture only those; an unknown
id exits 2 and lists the valid ones. Prints one line per file, then
`Next: npx queek theme check`. With `--json` it prints
`{ files: [{ design, file, bytes }] }` (files relative to the project root) instead.

```bash
queek theme screenshot food
```

It starts the same preview `dev` serves (on `--port`, or the first free port in
7833–7852) and drives it with a Chromium-based browser — the first that launches:

1. `QUEEK_THEME_BROWSER` (a Chromium-based executable path),
2. Google Chrome,
3. Microsoft Edge,
4. Playwright's own chromium (run `npx playwright install chromium` once to get it).

With none of those it exits 2. `playwright-core` (not `playwright`) is the dependency,
so installing the CLI downloads no browser.

| Flag | Default | |
|---|---|---|
| `--path <dir>` | `.` | The theme project, or its theme folder. |
| `--port <n>` | `7833, or the next free port` | Same strict rule as `dev`. |

### `queek theme check`

Checks the theme against the [theme contract](https://github.com/usequeek/theme-starter/blob/main/docs/THEME.md)
— the rules Queek runs when you submit, except the few that need Queek's side, which the report
lists. Every finding has a rule id, the file, what to do, and a link to the contract.

```bash
queek theme check --format json > report.json
```

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
- run: npx queek theme check --format github-actions
```

### `queek theme package`

Writes `<slug>.zip` with the theme folder (never `node_modules`, `.queek` or `.git`) for
submission, and warns if errors would block it. `--output <file>` to choose where.
`--json` returns `{ theme, file, bytes, sha256, errors, warnings }` instead of the
human line; `--verbose` debugs on stderr like `check`.

```bash
queek theme package --output dist/my-theme.zip
```

### `queek theme info`

Prints what a bug report needs — tool versions, the project (slug, templates,
designs, package manager), the installed framework versions, the vocabulary
source, the preview port and the screenshot browser — in one paste. Works
outside a theme project too. `--json` prints the same data as one object;
`--online` allows the network when resolving the vocabulary.

```bash
queek theme info
```

### `queek theme init [dir]`

The same as `npm create @usequeek/theme [dir]`, with the same flags; see
[create-theme's README](https://github.com/usequeek/theme-tools/tree/main/packages/create-theme#usage). In a terminal, anything you leave out is
asked; with `--yes` or without a terminal, nothing is, and `--templates` and `--tags` are
required. With no `dir`, the folder is named after the theme in a terminal, `my-theme`
otherwise.

```bash
queek theme init my-theme --templates laundry,foods --primary laundry --tags minimal --yes
```

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

## Apps (`queek auth login`, `queek app …`)

```bash
queek app init my-app       # from usequeek/queek-app-starter (== npm create @usequeek/app)
queek app dev               # tunnel + owned test-store install, re-registers on save
queek app deploy            # queek.app.toml → version N+1, released (secret shown once)
queek app deploy --version 1.2.0 --message "Greeting"   # name the version + note
queek app deploy --no-release                           # create without serving
queek app config link hello # server manifest → queek.app.toml (no config push: deploy carries config)
queek app versions list hello
queek app release hello 1.2.0   # semver resolves to its sequence; digits address it directly
queek app submit hello                # checklist + form + attestation → review (default: latest version)
queek app submit hello --sequence 3   # submit one sequence explicitly
queek app withdraw hello              # in_review back to development (--yes in CI)
queek auth login            # rarely needed: app commands sign in automatically
queek auth logout
```

Behind the backend's explicit-submit switch, `deploy` and `release` can answer
HTTP 409 `review_required` instead of releasing: the CLI prints
`v{version} is ready for review. Run: queek app submit …` and exits 0 — a
successful deploy is not a failure. `submit` runs the readiness checklist
(errors block before anything is asked), collects the form (flags in CI,
prompts on a TTY), requires explicit warning acknowledgement and agreement to
every server-provided attestation clause, and POSTs with an Idempotency-Key.
Test instructions take test-store credentials only, never production
credentials. Success prints `Submitted v{version} — review usually within 3
business days.`

`queek.app.toml` is the local source of truth (same names as the server manifest,
grouped: `[listing]`, `[access]`, `[webhooks]`, `[app]`, `[[settings]]`,
`[extensions]`, `[dashboard]`); `-c/--config <name>` reads `queek.app.<name>.toml`.
The toml carries no `version` — the backend auto-assigns the next patch (a leftover
`version` warns once and is ignored). `handle` is CLI-only sugar for `slug`.
Secrets never live in the toml — deploy writes the registration secret to
`.queek/.env.local` (gitignored). Apps are addressed by `p_id|slug`, never UUID.

Auth: commands sign in automatically when there is no valid session (browser
OAuth; device code with `--no-browser` or when headless). The 60-minute access
token refreshes transparently. In CI, `QUEEK_APP_AUTOMATION_TOKEN` (a per-app
App Automation Token from the Developer page) authenticates `deploy`, `release`,
`submit`, `versions list` and `config link` with no login — a 401/403 means the
token is outside its app's grant (never a dead session, never a login prompt).
`QUEEK_API_BASE` overrides the backend host (vendor API at `/api/v1/biz/…`,
OAuth at `/oauth/…`).

### Why these layers are new (necessity gate)

Every `app`/`auth` layer below was added because the theme CLI has no
primitive it could reuse — each row names the file checked, the Shopify
counterpart it mirrors, and why the theme code could not serve.

| New layer | Existing primitive checked | Shopify counterpart | Why it differs |
|---|---|---|---|
| `src/lib/app-manifest.ts` (grouped `queek.app.toml` → flat 25-key manifest, exit-2 pre-check) | `src/lib/project.ts:11` — a theme project is a folder holding `manifest.ts`; no app declaration exists anywhere in the CLI | [app-configuration](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration) | maps toml groups onto the server manifest (`handle`→`slug` sugar, `available_if`, secret refusal); themes have no manifest to map |
| `src/lib/app-api.ts` (`DeveloperApi`: vendor envelope + OAuth routers + per-call auth kinds) | no HTTP client in `src/` — theme commands are local-only (`src/commands/dev.ts:21` serves `127.0.0.1`) | [app-deploy](https://shopify.dev/docs/api/shopify-cli/app/app-deploy) | `{data}` unwrap, `data.status` reads, sequence release, automation-token refusal wording; nothing to reuse |
| `src/lib/app-auth.ts` (keychain-or-0600 session file + CI automation token) | `src/lib/base-command.ts:8` — `QUEEK_THEME_*` flag env only, no credential storage; `src/lib/keytar.d.ts:1` is an unused type shim | [CLI command reference](https://shopify.dev/docs/api/shopify-cli) (`queek auth login` ≈ `shopify auth login`) | first credential storage in the CLI, with a token kind that must never trigger a login |
| `src/lib/app-session.ts` (browser PKCE loopback + device-code fallback) | `src/lib/browser.ts:1` — `playwright-core` drives a downloaded browser for screenshots | same CLI reference | login must use the user's own browser (zero downloads, RFC 8252 loopback kept bound) with a headless device fallback (RFC 8628) |
| `src/lib/app-tunnel.ts` (public URL for `app dev`) | `src/commands/dev.ts:21-23` + `src/lib/port.ts:33` — binds localhost + next free port; nothing public | [networking options](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options) | install/notify/webhook URLs must be public HTTPS: Cloudflare Quick Tunnel or `--url` |
| `packages/create-app` (scaffolder) | `packages/create-theme/src` — scaffolds storefront theme projects | [app-init](https://shopify.dev/docs/api/shopify-cli/app/app-init) | the app starter is Hono + SDK + `queek.app.toml` + Dockerfile, not a theme |

## Project config (`.queek-theme.yml`)

`check` and `package` read `.queek-theme.yml` at the project root (beside `package.json`);
`queek theme check --init` writes a starter. The config changes warnings only. Errors are
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

## New rule

- `theme/markdown-html` (error): `renderMarkdown` returns React elements, not an HTML
  string — passing it to `dangerouslySetInnerHTML` renders "[object Object]". Render the
  elements as children, or use `<Markdown>` from `@usequeek/theme-kit/components/markdown`.

## Environment

- Every flag of `dev` and `check` has a `QUEEK_THEME_*` variable (`QUEEK_THEME_PORT`, …),
  including `QUEEK_THEME_VERBOSE` for `--verbose`. The flags stay `QUEEK_THEME_*` under
  both bins: they are theme-scoped, like the topic.
- `QUEEK_THEME_BROWSER` points `screenshot` at a Chromium-based browser executable.
- `NO_COLOR` turns colour off; output is plain when not a terminal.
- Once a day the CLI mentions a newer version; `QUEEK_THEME_SKIP_NEW_VERSION_CHECK=true`
  (or `QUEEK_SKIP_NEW_VERSION_CHECK=true` for the `queek` bin) turns that off. It never
  checks in CI (`CI` set to anything but `''`/`'false'`/`'0'`), nor when
  `QUEEK_THEME_NO_UPDATE_CHECK` (or `QUEEK_NO_UPDATE_CHECK`) is set likewise.
- It collects no usage data.

## License

MIT
