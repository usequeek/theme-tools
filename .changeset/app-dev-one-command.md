---
"@usequeek/cli": minor
---

`queek app dev` is now a one-command loop. A new app slug is registered automatically (like `queek app deploy --no-release`). `--create-dev-store` creates a new dev store even when you already own others, and refuses with the server's reason when your plan or limit says no. With one dev store it is used, with several you choose on a terminal (a choice that includes "Create a new dev store") or pass `--store` in CI; the choice is remembered in `.queek/dev.json`. The command waits visibly (90s by default, `--tunnel-timeout <seconds>` or `QUEEK_APP_TUNNEL_TIMEOUT`) for the tunnel to resolve and answer `/health`, and stops before installing, with the reason, if it does not. New `--use-localhost` embeds the app in the dashboard from `http://localhost:<port>` plus the path of `[extensions] merchant_page_url` (it needs that page) while the tunnel keeps serving install, uninstall and webhook calls. New `queek app dev clean` (with `--reset`) removes the dev install.

Every API failure now prints its request id on its own line. The dev store's storefront password is now printed only once, when the CLI creates the store. The ready block and `queek app info` (including its `--json` output, which drops `storefrontPassword`) no longer print it.
