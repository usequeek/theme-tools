# @usequeek/cli

Formerly `@usequeek/theme-cli` (bin `queek-theme`); from 0.7.0 the CLI is `@usequeek/cli`, bin `queek`, with the theme commands under `queek theme`.

## 0.14.0

### Minor Changes

- [#9](https://github.com/usequeek/theme-tools/pull/9) [`62995ea`](https://github.com/usequeek/theme-tools/commit/62995ea292b8dc835d151e6b5de84339b13fcabe) Thanks [@ichie-benjamin](https://github.com/ichie-benjamin)! - Add the `queek app` developer flow (Shopify-shaped, self-serve), verified against the S1 backend build: `queek auth login` (browser-open OAuth against the reused connector `cli` client, device-code fallback for headless shells) and `queek auth logout`, plus `app init` (from the public starter), `app dev` (tunnel + owned test-store install, auto dev URLs, watch), `app deploy [--version X.Y.Z] [--message ..] [--no-release]` (toml → version, released by default; the toml carries no `version`, the backend auto-assigns; identical manifests no-op; signing secret shown once into `.queek/.env.local`), `app config link` (server → toml; no config push — deploy carries config), `app versions list`, `app release [<version>|--version]` (released vs in_review wording, plus 409 review_required tolerance behind the explicit-submit switch) and `app submit [--sequence]` (readiness checklist, explicit warning acknowledgement, server-provided attestation, Idempotency-Key) with `app withdraw` (in_review back to development). App commands sign in automatically when there is no valid session (`--no-browser` forces the device code); the 60-minute access token refreshes transparently. In CI, `QUEEK_APP_AUTOMATION_TOKEN` authenticates with no login; a refusal (401) names the app and the actions the token allows. `queek.app.toml` (+ `-c/--config` variants) maps exactly to the backend `AppManifestValidator` keys; `handle` is CLI-only sugar for `slug`, secrets in toml are refused. New `@usequeek/create-app` package behind `npm create @usequeek/app`.
  
  S-B (Shopify dev-loop parity, coded exactly to the S-A contract, mocked in tests): `queek app dev --store` accepts only dev stores (GET dev-stores; non-dev `--store` refused with Shopify's wrong-kind copy); with none, one TTY question (or `--create-dev-store` in CI) creates one named after the app with test data (POST dev-stores {name, test_data} + Idempotency-Key, D1). Ready block prints `✅ Ready, watching for changes`, the tunnel URL and the Preview URL (admin_url + `&app={slug}`, D4); every install/app line logs with time + source. B1: deviceLogin backs off +5s (capped 30s) on `slow_down`/429 and polls until expiry, never throwing on them. B2: every `dev` error path stops the tunnel via try/finally (tested). B4 kept. New `queek app info` (config file, app, app ID, scopes, dev store, user); `queek app deploy` prints `New version released — <slug>-N · <message> · <link>` with the one-version URL (`?app={p_id}&section=versions&version={sequence}`, D5) and server validation errors verbatim (`--message/--version/--no-release` unchanged). dev-installs keeps its body field (D6); dev-store deletion stays dashboard-side (D7, no CLI delete).
  
  S-C (AI-ready starter): scaffolded output ships `AGENTS.md` (SDK, queek.app.toml, dev loop, https://docs.usequeek.com, MCP status, "do not add tooling to this repo"), `CLAUDE.md` (`@AGENTS.md` exactly), `.mcp.json` + `.cursor/mcp.json` (empty `mcpServers` — no developer MCP endpoint/package exists in the repos yet: backend MCP mounts are customer/merchant, so docs are wired instead), and the success banner names the AI setup.
  
  R27/R1+R2: `DevStore` carries the owner-visible `storefront_password` (threaded through create, never dropped); `dev` prints it once after creation and in the ready block (`Storefront password: …`, stdout only — never debug/logs), and `info --store` shows it. First-run creates default to "<app name> dev" with `--dev-store-name` / `--dev-store-address` overrides (slug omitted → backend default; taken → 422 suggestion verbatim).

### Patch Changes

- [#9](https://github.com/usequeek/theme-tools/pull/9) [`c0d8007`](https://github.com/usequeek/theme-tools/commit/c0d8007d4403e6635871a0dbea104f9d94408831) Thanks [@ichie-benjamin](https://github.com/ichie-benjamin)! - Review fixes (REVISE → address): hermetic `GITHUB_ACTIONS` handling in the
  codegen tests (both CI-shaped and local cases pin the variable they need, so
  the suite passes identically with and without `GITHUB_ACTIONS=true CI=true`);
  `[access] optional_scopes` round-trip support in the toml mirror/mapping
  (requested post-install, never granted at install, disjoint from `scopes`;
  `scopes` may now be empty per the backend `present,array` rule; dashboard
  action scopes resolve against either tier); a sorted-keys snapshot of the
  28-key manifest mirror plus the `extensions` sub-keys that fails loudly on
  backend `AppManifestValidator::topLevelKeys()` drift; one shared
  `ensureQueekIgnored()` helper (init/dev/deploy) so `.queek/` is actually
  gitignored, not just called that; 0600 on the deploy-written `.env.local`;
  toml-watcher burst coalescing in the deploy queue; and a comment aligning the
  unreachable-per-supervision `MAX_TUNNEL_RESTARTS=5` with the 3-per-10-minutes
  window cap.
  
  Ordering: this CLI release must ship AFTER the backend optional-scopes push
  (`scopes` present-but-empty + `optional_scopes` in `AppManifestValidator`) —
  against the older backend, `optional_scopes` deploys 422 and empty `scopes`
  is refused server-side.
- Updated dependencies [[`62995ea`](https://github.com/usequeek/theme-tools/commit/62995ea292b8dc835d151e6b5de84339b13fcabe)]:
  - @usequeek/create-app@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [`ad72fa1`]:
  - @usequeek/theme-check@0.13.0
  - @usequeek/create-theme@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [`0b3f76c`]:
  - @usequeek/theme-check@0.12.0
  - @usequeek/create-theme@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [`9186281`]:
  - @usequeek/theme-check@0.11.0
  - @usequeek/create-theme@0.11.0

## 0.10.1

### Patch Changes

- `queek theme add` works on Windows: it creates the `demos` folder, edits a CRLF `theme.config.ts` in place, and `--json` reports paths with `/`.
- Updated dependencies [[`17ac64f`](https://github.com/usequeek/theme-tools/commit/17ac64f7674a815e5284e2720903e6371d813694)]:
  - @usequeek/create-theme@0.10.1

## 0.10.0

### Minor Changes

- `queek theme add template|design|page`: grow a theme after scaffolding — a template (new demo store from the bundled skeleton, declared in theme.config.ts), a second or third design of a template, and the contact/faq page on a design's store. Config edits go through the AST (magicast), every prompt has a flag, `--dry-run` writes nothing, `--json` prints `{ added, files }`.

- `queek theme info` prints what a bug report needs

### Patch Changes

- Updated dependencies [`977c8b3`, `314a322`]:
  - @usequeek/create-theme@0.10.0

## 0.9.2

### Patch Changes

- Runs on @oclif/core 5 and the version-check plugin 4; commands, flags and output are unchanged.

## 0.9.0

### Patch Changes

- Updated dependencies [`6b02c94`]:
  - @usequeek/theme-check@0.9.0
  - @usequeek/create-theme@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [`1a1668a`]:
  - @usequeek/theme-check@0.8.0
  - @usequeek/create-theme@0.8.0

## 0.7.0

### Minor Changes

- The CLI is now `@usequeek/cli` with `queek theme dev|check|screenshot|package|init`
  — one package, no alias. The starter switches to `@usequeek/cli`.
  `theme-check` fix texts name `npx queek theme screenshot`.

### Patch Changes

- Updated dependencies [`042a0cf`]:
  - @usequeek/theme-check@0.7.0
  - @usequeek/create-theme@0.7.0

## 0.6.0

### Minor Changes

- - Reject passing renderMarkdown output to dangerouslySetInnerHTML, which renders "[object Object]" on the page.
  - Tune warnings per project with .queek-theme.yml, without ever silencing errors.
  - Print the check report with --json and zip details with package --json, keeping exit codes.
  - Debug check and package with --verbose lines on stderr.
  - Never show the new-version notice in CI or when update checks are opted out.

- - `queek-theme dev` serves on port 7833 by default, or the next free port up to 7852 when 7833 is busy; a given `--port` stays strict and exits 2 when busy.
  - New `queek-theme screenshot` command captures every design's first screen at 1280x800 into the files the checker reads, using Google Chrome, Edge, Playwright's chromium, or QUEEK_THEME_BROWSER.
  - The checker's screenshot fixes tell developers to run `npx queek-theme screenshot`, and its preview links use port 7833.

### Patch Changes

- Updated dependencies [`591956a`, `350c352`]:
  - @usequeek/create-theme@0.6.0
  - @usequeek/theme-check@0.6.0

## 0.5.0

### Minor Changes

- Live business vocabulary (R2.9): one resolver in theme-check (`resolveVocabulary`, OS cache dir, conditional GET with `If-None-Match: "<version>"`, cache-then-bundled fallback with a notice), `checkTheme(dir, { vocabulary })` with `check --json` reporting `vocabulary: { source, version }`, a warn-only `theme/template-business` advisory when a template names only `shop`, and `--vocabulary <file>` / `--offline` on `queek-theme check`, `dev`, `package` and `init` plus `npm create @usequeek/theme`. create-theme prompts from the cached-or-bundled copy, refreshes live in the background, revalidates the final `for` against the fresh copy, and lists `shop` last as "General store". Bundled snapshot synced to the R2.9 production vocabulary (version `d1f9c8ee`). Also adds `theme/composition-variants` (reject): every section in every design's pages must name a variant the theme implements (the manifest's declared variants — the registry's `implemented_variants`).

### Patch Changes

- Updated dependencies [`84574cc`]:
  - @usequeek/theme-check@0.5.0
  - @usequeek/create-theme@0.5.0

## 0.4.0

### Minor Changes

- `queek-theme dev` lists a theme's stores as theme → template → design (contract R2.8). The index has one section per template (its label and "N designs"), in the order Queek groups them: the main template first, then each template's design 1 first. Each design is listed by its `design_label` and keeps its URL `/<id>`. The hint for an undeclared file shows `{ id, template, label, for, description }`. The grouping comes from the design resolver `@usequeek/theme-check/designs`, which is copied into the preview, so the project never has to resolve theme-check itself. `init`'s `--primary` is described as the main template.

### Patch Changes

- Updated dependencies [`e13c295`, `63d3d72`]:
  - @usequeek/create-theme@0.4.0
  - @usequeek/theme-check@0.4.0

## 0.3.0

### Minor Changes

- A theme never imports Next.js. `theme/core-boundary` now rejects any import of `next` or `next/*` (static, side-effect, dynamic or `require`): link and navigate with `import { Link, useRouter, usePathname } from '@usequeek/theme-kit/navigation'` (theme-kit 0.1.10). Which framework runs the storefront is Queek's to change; a theme written against the kit keeps working when it does. The starter uses the kit's navigation and needs `@usequeek/theme-kit` 0.1.10 or later.

### Patch Changes

- Updated dependencies []:
  - @usequeek/theme-check@0.3.0
  - @usequeek/create-theme@0.3.0

## 0.2.1

### Patch Changes

- The starter's hero button shows its label (a link rule outranked the button's colour), and the starter points you at `npm run check`. `queek-theme dev` no longer shows Next's corner badge over your theme.
- Updated dependencies []:
  - @usequeek/create-theme@0.2.1

## 0.2.0

### Minor Changes

- `npm create @usequeek/theme` is a guided setup: the theme's name, its templates (businesses picked from the platform's list, and which is primary), categories, tags, extra pages and AI assistants, each also a flag (`--name`, `--templates`, `--primary`, `--categories`, `--tags`, `--pages`, `--ai`/`--no-ai`, `--yes`, `--dry-run`, `--force`, `--pm`). It renames the skeleton for you, writes one demo store per template, and keeps AGENTS.md plus the files for the assistants you chose. `queek-theme init` takes the same flags. New rule `theme/placeholder-content`: the starter's placeholder products and photos, and its placeholder theme description, never ship.

- [`b0c44ea`](https://github.com/usequeek/theme-tools/commit/b0c44ea0fc836dd4bb2351b9e94f48a581b8afd9) Thanks [@ichie-benjamin](https://github.com/ichie-benjamin)! - New rule `theme/template-copy`: a template's section copy must be true of any store in its business, because Queek publishes it onto new stores unchanged. It rejects copy that names the demo store, a place, a naira amount or a promise only the vendor can make (same-day, 30-day returns, free delivery, guarantees) a founding date ("since 2014"), or an email or phone number in the text. Testimonials and reviews are exempt. A section's copy no longer includes the demo store's email, phone, address, opening hours, coupon code or hotspot coordinates.
  
  The business vocabulary gains `jewelry` (Fashion › Bags & Accessories › Jewelry, a new third level, `subcategories`) and `beverages` (Supermarket › Beverages).
  
  New rule `theme/vendor-facts`: a vendor's tagline, address, phone, email or description must never fall back to the theme's own words (`vendor.address ?? 'Lagos, Nigeria'`); a store without one would show them as its own.
  
  `theme/template-business` rejects a template that names a business category but leads with a catalogue key: a template for a whole business leads with its category, a niche one names only catalogue keys.
  
  `theme/template-copy` also rejects offers and coupon codes, opening hours, store age and more naira and phone forms, and a time window counts as a promise only next to a service ("Delivered in 2 hours", not "Cold brewed for 12–24 hours"). `theme/vendor-facts` reads ternaries, variables and destructuring. New `theme/fonts-self-hosted`: `next/font/google` is rejected (it fails builds); a Google Fonts `@import` is a warning.

### Patch Changes

- [`21b26e4`](https://github.com/usequeek/theme-tools/commit/21b26e4734341d1437ee8e4b41d77c5edaae7880) Thanks [@ichie-benjamin](https://github.com/ichie-benjamin)! - Commands load from an explicit list instead of a scan of the CLI's own folder at startup.
- Updated dependencies [`1fb0717`, [`b0c44ea`](https://github.com/usequeek/theme-tools/commit/b0c44ea0fc836dd4bb2351b9e94f48a581b8afd9)]:
  - @usequeek/create-theme@0.2.0
  - @usequeek/theme-check@0.2.0
