---
"@usequeek/cli": patch
---

The app manifest accepts a `submit` primitive in a block's schema (one per block, and only when `extensions.proxy.allow_post` is true), so the storefront block can post its choices to the app through the signed proxy.
