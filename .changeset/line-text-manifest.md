---
"@usequeek/cli": minor
---

`queek.app.toml` validates the `line_text` input primitive and its `max_length` on storefront blocks: a block holding a `line_text` field holds only `line_text` fields and sets `available_if = "declared_products"`, a manifest declares at most three, keys are unique, and the derived property key `app.<handle>.<key>` stays within 64 characters (a field key may not be `claim`, `reschedule_url` or `cancel_url`). A `line_text` field needs a non-empty label, and `required` and `max_length` must be a real boolean and whole number. Dashboard blocks and actions still refuse both.
