---
"@usequeek/cli": patch
---

`queek.app.toml` now accepts the shopper account manifest as the server does: an `app_page` block with the `account-page` target and a `url`, and one block with the `account-order` target. The check also refuses a title that is not 1-40 characters of visible text, a second page or account block, a page url that is not https, carries credentials or a fragment, or sits on a Queek domain, and an account block without `extensions.proxy.share_customer_id`, so `queek app deploy` fails locally instead of at the server. A `url` on any other block is still refused as an unknown field.
