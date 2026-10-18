---
"@usequeek/cli": minor
---

`queek app dev` is now a one-command loop.

- A new app slug is registered automatically, the way `queek app deploy --no-release` would.
- `--create-dev-store` creates a new dev store even when you already own others, and stops with the server's reason when your plan or limit says no. With one dev store it is used; with several you choose on a terminal (the choice includes "Create a new dev store") or pass `--store` in CI. The choice is remembered in `.queek/dev.json`; an explicit `--store` never changes it.
- The command waits visibly for the tunnel to resolve and answer `/health` (90 seconds by default; `--tunnel-timeout <seconds>` or `QUEEK_APP_TUNNEL_TIMEOUT`). If the tunnel never answers, it now stops before installing and says why. Before, it warned and installed anyway; this also applies to `--url` tunnels.
- New `--use-localhost` embeds the app in the dashboard from `http://localhost:<port>` plus the path of `[extensions] merchant_page_url` (that page is required), so hot reload works there. The tunnel keeps serving install, uninstall and webhook calls.
- New `queek app dev clean` (with `--reset`) removes the dev install from a dev store.
- Failures from every `queek app` command now print the server's request id on its own line, so support can find the request.
- The dev store's storefront password is printed once, when the CLI creates the store, and never again: `queek app info` (including `--json`) and the ready block no longer print it.
