# @usequeek/create-theme

## 0.10.1

### Patch Changes

- [#8](https://github.com/usequeek/theme-tools/pull/8) [`17ac64f`](https://github.com/usequeek/theme-tools/commit/17ac64f7674a815e5284e2720903e6371d813694) Thanks [@ichie-benjamin](https://github.com/ichie-benjamin)! - `queek theme add` creates the `demos` folder on Windows too: it built the folder from a `/`-split relative path, and Windows paths use `\`.

## 0.10.0

### Minor Changes

- `queek theme add template|design|page`: grow a theme after scaffolding — a template (new demo store from the bundled skeleton, declared in theme.config.ts), a second or third design of a template, and the contact/faq page on a design's store. Config edits go through the AST (magicast), every prompt has a flag, `--dry-run` writes nothing, `--json` prints `{ added, files }`.

### Patch Changes

- Closing next steps point at the guides (https://docs.usequeek.com/docs/themes)

## 0.9.0

### Patch Changes

- Updated dependencies [`6b02c94`]:
  - @usequeek/theme-check@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [`1a1668a`]:
  - @usequeek/theme-check@0.8.0

## 0.7.0

### Minor Changes

- The CLI is now `@usequeek/cli` with `queek theme dev|check|screenshot|package|init`
  — one package, no alias. The starter switches to `@usequeek/cli`.
  `theme-check` fix texts name `npx queek theme screenshot`.

### Patch Changes

- Updated dependencies [`042a0cf`]:
  - @usequeek/theme-check@0.7.0

## 0.6.0

### Minor Changes

- New themes get `npm run screenshot` (every design's first screen at 1280×800, into the files the check reads) and preview on port 7833, or the next free one. The starter requires @usequeek/theme-cli 0.6.

### Patch Changes

- Updated dependencies [`591956a`, `350c352`]:
  - @usequeek/theme-check@0.6.0

## 0.5.2

### Patch Changes

- New themes render footer columns, pages and blog posts as formatted text instead of "[object Object]". The starter's skeleton passed `renderMarkdown` (which returns elements) to `dangerouslySetInnerHTML`; it now renders the elements directly. The starter also picks up the product page's app blocks slot.

## 0.5.0

### Minor Changes

- Live business vocabulary (R2.9): one resolver in theme-check (`resolveVocabulary`, OS cache dir, conditional GET with `If-None-Match: "<version>"`, cache-then-bundled fallback with a notice), `checkTheme(dir, { vocabulary })` with `check --json` reporting `vocabulary: { source, version }`, a warn-only `theme/template-business` advisory when a template names only `shop`, and `--vocabulary <file>` / `--offline` on `queek-theme check`, `dev`, `package` and `init` plus `npm create @usequeek/theme`. create-theme prompts from the cached-or-bundled copy, refreshes live in the background, revalidates the final `for` against the fresh copy, and lists `shop` last as "General store". Bundled snapshot synced to the R2.9 production vocabulary (version `d1f9c8ee`). Also adds `theme/composition-variants` (reject): every section in every design's pages must name a variant the theme implements (the manifest's declared variants — the registry's `implemented_variants`).

### Patch Changes

- Updated dependencies [`84574cc`]:
  - @usequeek/theme-check@0.5.0

## 0.4.2

### Patch Changes

- Fix `renameContent` for real themes: rename CSS custom properties (`--<prefix>-`), data attributes (`data-<prefix>-`), component heads (`MedleyModalLayer` via the display name's PascalCase), and store ids (`<slug>-<id>`); never rewrite inside `https?://` URLs. Preview paths (`/<slug>~<id>`) follow the new slug since the copied demo is the new theme's own store.

## 0.4.0

### Minor Changes

- Creates themes as theme → template → design (contract R2.8). Each business picked becomes a template with one design, and `theme.config.ts` declares `template` on every design: the business key picked, on `default_demo` for the main template (`--primary`) and on each `demos[]` entry, whose id is its key. So the new `theme/template-designs` check passes on a fresh theme. A template is never inferred from an id, and no `<key>-2` ids are written. `TemplatePlan` gains `template`. The prompt asks "Which template is the main one?"; the flag stays `--primary`.

## 0.3.7

### Patch Changes

- `shop-4-me` leaves the business vocabulary again: it is not a storefront business.

## 0.3.6

### Patch Changes

- The business vocabulary gains `shop-4-me` (Shop for me), a service key.

## 0.3.4

### Patch Changes

- Export `renameTheme`, `SKELETON` and the `Identity` type, so a tool that copies a theme under a new name uses the same rename as `npm create`.

## 0.3.2

### Patch Changes

- The starter's demo images are now labelled placeholders instead of fashion photos.

## 0.3.1

### Patch Changes

- A new project installs `@usequeek/theme-cli` 0.3, the checker that rejects Next.js imports; the 0.3.0 starter still asked for 0.1 or 0.2.

## 0.3.0

### Minor Changes

- A theme never imports Next.js. `theme/core-boundary` now rejects any import of `next` or `next/*` (static, side-effect, dynamic or `require`): link and navigate with `import { Link, useRouter, usePathname } from '@usequeek/theme-kit/navigation'` (theme-kit 0.1.10). Which framework runs the storefront is Queek's to change; a theme written against the kit keeps working when it does. The starter uses the kit's navigation and needs `@usequeek/theme-kit` 0.1.10 or later.

## 0.2.1

### Patch Changes

- The starter's hero button shows its label (a link rule outranked the button's colour), and the starter points you at `npm run check`. `queek-theme dev` no longer shows Next's corner badge over your theme.

## 0.2.0

### Minor Changes

- `npm create @usequeek/theme` is a guided setup: the theme's name, its templates (businesses picked from the platform's list, and which is primary), categories, tags, extra pages and AI assistants, each also a flag (`--name`, `--templates`, `--primary`, `--categories`, `--tags`, `--pages`, `--ai`/`--no-ai`, `--yes`, `--dry-run`, `--force`, `--pm`). It renames the skeleton for you, writes one demo store per template, and keeps AGENTS.md plus the files for the assistants you chose. `queek-theme init` takes the same flags. New rule `theme/placeholder-content`: the starter's placeholder products and photos, and its placeholder theme description, never ship.
