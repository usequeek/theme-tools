---
"@usequeek/cli": patch
---

`queek.app.toml` now accepts the `add_to_cart` block field type (one field alone in a product block, with `extensions.proxy`) and refuses what the server refuses for it: a second field, a `required` or `options` key on it, a block that is not a plain `app_block` on the `product` target, a button label or block title that is not 1-40 characters of visible text, no `extensions.proxy`, and more than two such blocks, so `queek app deploy` fails locally instead of at the server.
