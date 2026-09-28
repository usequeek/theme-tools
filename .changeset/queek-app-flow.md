---
'@usequeek/cli': minor
'@usequeek/create-app': minor
---

Add the `queek app` developer flow (Shopify-shaped, self-serve): `queek login` (browser-open OAuth against the reused connector `cli` client, device-code fallback for headless shells; token in the OS keychain with `QUEEK_CLI_TOKEN` override) and `queek logout`, plus `app init` (from the public starter), `app dev` (tunnel + owned test-store install, auto dev URLs, watch), `app deploy` (queek.app.toml → developer API → version; secret shown once into `.queek/.env.local`), `app config link` (server → toml; no config push — deploy carries config), `app versions list`, `app release <version>` and `app submit`. `queek.app.toml` (+ `-c/--config` variants) maps exactly to the backend `AppManifestValidator` keys; `handle` is CLI-only sugar for `slug`, secrets in toml are refused. New `@usequeek/create-app` package behind `npm create @usequeek/app`.
