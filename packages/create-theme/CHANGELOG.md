# @usequeek/create-theme

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
