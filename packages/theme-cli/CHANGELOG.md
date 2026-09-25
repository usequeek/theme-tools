# @usequeek/theme-cli

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
