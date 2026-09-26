# @usequeek/theme-check

## 0.5.0

### Minor Changes

- Live business vocabulary (R2.9): one resolver in theme-check (`resolveVocabulary`, OS cache dir, conditional GET with `If-None-Match: "<version>"`, cache-then-bundled fallback with a notice), `checkTheme(dir, { vocabulary })` with `check --json` reporting `vocabulary: { source, version }`, a warn-only `theme/template-business` advisory when a template names only `shop`, and `--vocabulary <file>` / `--offline` on `queek-theme check`, `dev`, `package` and `init` plus `npm create @usequeek/theme`. create-theme prompts from the cached-or-bundled copy, refreshes live in the background, revalidates the final `for` against the fresh copy, and lists `shop` last as "General store". Bundled snapshot synced to the R2.9 production vocabulary (version `d1f9c8ee`). Also adds `theme/composition-variants` (reject): every section in every design's pages must name a variant the theme implements (the manifest's declared variants — the registry's `implemented_variants`).

## 0.4.1

### Patch Changes

- Close gaps in the template-copy gate. It now scans every design's `config.header.announcement.text` like section copy, and flags offers and promises it missed: half-price, a bare sale (but not wholesale, salesperson or for sale by the kilo), discount and coupon; free or complimentary samples, styling, gifts, consultations, fittings and refills; a weekday with a clock time; tailoring and alteration windows; "returns, always"; and fast replies.

## 0.4.0

### Minor Changes

- Theme → template → design (contract R2.8). A theme is the look, a template is a business it is dressed as, and a design is one concrete store of a template (one demo file).
  
  - New rule `theme/template-designs` (reject). It groups designs by the `template` key each one declares in theme.config.ts, never by an id's `-2` suffix, and checks that:
    - every design names its template with a slug key, never `default`;
    - the main template's key is not also a design id (keys and ids share one namespace);
    - every template has a design 1, the design whose id is its key;
    - a later design repeats its template's `label` and `for` unchanged, or leaves them out and inherits them;
    - every design of a template with two or more designs has a `design_label`, unique within the template and true of any store (the template copy rules);
    - a template has at most three designs.
  - `theme/template-versions` keeps its id. It now checks only that no two designs share a home composition.
  - `theme/demo-stores` asks for `label` and `for` only on each template's design 1. Its fix for an undeclared file shows `{ id, template, label, for, description }`.
  - `theme/template-business` checks each template's `for` once.
  - The design resolver is exported (`designsOf`, `groupTemplates`, `mainTemplateKey`, `composeLabel` and their types) and published alone as `@usequeek/theme-check/designs`. It has no dependencies.
  - `ThemeContext` gains `themeConfig`. `DeclaredDemo` gains `template` and `design_label`, and its `label` and `for` become optional.

## 0.3.7

### Patch Changes

- `shop-4-me` leaves the business vocabulary again: it is not a storefront business.

## 0.3.6

### Patch Changes

- The business vocabulary gains `shop-4-me` (Shop for me), a service key.

## 0.3.5

### Patch Changes

- Findings name theme files with `/` on Windows too (`styles/type.css`, not `styles\type.css`), the same on every OS.

## 0.3.3

### Patch Changes

- `theme/fonts-self-hosted` now rejects a Google Fonts `@import` in a theme stylesheet, matching the storefront's own checker instead of only warning. The package entry (`@usequeek/theme-check`) also now exports `STATIC_RULES`, `ANALYSIS_RULES`, every individual rule constant, and the `frameworkImport`/`STARTER_PLACEHOLDER_IMAGES` helpers, so rule-level unit tests can run one rule against a hand-built context without going through a whole theme directory.

## 0.3.2

### Patch Changes

- The starter's demo images are now labelled placeholders instead of fashion photos.

## 0.3.0

### Minor Changes

- A theme never imports Next.js. `theme/core-boundary` now rejects any import of `next` or `next/*` (static, side-effect, dynamic or `require`): link and navigate with `import { Link, useRouter, usePathname } from '@usequeek/theme-kit/navigation'` (theme-kit 0.1.10). Which framework runs the storefront is Queek's to change; a theme written against the kit keeps working when it does. The starter uses the kit's navigation and needs `@usequeek/theme-kit` 0.1.10 or later.

## 0.2.0

### Minor Changes

- `npm create @usequeek/theme` is a guided setup: the theme's name, its templates (businesses picked from the platform's list, and which is primary), categories, tags, extra pages and AI assistants, each also a flag (`--name`, `--templates`, `--primary`, `--categories`, `--tags`, `--pages`, `--ai`/`--no-ai`, `--yes`, `--dry-run`, `--force`, `--pm`). It renames the skeleton for you, writes one demo store per template, and keeps AGENTS.md plus the files for the assistants you chose. `queek-theme init` takes the same flags. New rule `theme/placeholder-content`: the starter's placeholder products and photos, and its placeholder theme description, never ship.

- [`b0c44ea`](https://github.com/usequeek/theme-tools/commit/b0c44ea0fc836dd4bb2351b9e94f48a581b8afd9) Thanks [@ichie-benjamin](https://github.com/ichie-benjamin)! - New rule `theme/template-copy`: a template's section copy must be true of any store in its business, because Queek publishes it onto new stores unchanged. It rejects copy that names the demo store, a place, a naira amount or a promise only the vendor can make (same-day, 30-day returns, free delivery, guarantees) a founding date ("since 2014"), or an email or phone number in the text. Testimonials and reviews are exempt. A section's copy no longer includes the demo store's email, phone, address, opening hours, coupon code or hotspot coordinates.
  
  The business vocabulary gains `jewelry` (Fashion › Bags & Accessories › Jewelry, a new third level, `subcategories`) and `beverages` (Supermarket › Beverages).
  
  New rule `theme/vendor-facts`: a vendor's tagline, address, phone, email or description must never fall back to the theme's own words (`vendor.address ?? 'Lagos, Nigeria'`); a store without one would show them as its own.
  
  `theme/template-business` rejects a template that names a business category but leads with a catalogue key: a template for a whole business leads with its category, a niche one names only catalogue keys.
  
  `theme/template-copy` also rejects offers and coupon codes, opening hours, store age and more naira and phone forms, and a time window counts as a promise only next to a service ("Delivered in 2 hours", not "Cold brewed for 12–24 hours"). `theme/vendor-facts` reads ternaries, variables and destructuring. New `theme/fonts-self-hosted`: `next/font/google` is rejected (it fails builds); a Google Fonts `@import` is a warning.
