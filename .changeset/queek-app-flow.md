---
'@usequeek/cli': minor
'@usequeek/create-app': minor
---

Add the `queek app` developer flow (Shopify-shaped, self-serve), verified against the S1 backend build: `queek auth login` (browser-open OAuth against the reused connector `cli` client, device-code fallback for headless shells) and `queek auth logout`, plus `app init` (from the public starter), `app dev` (tunnel + owned test-store install, auto dev URLs, watch), `app deploy` (`queek.app.toml` → `{manifest, changelog}` → version N+1; signing secret shown once into `.queek/.env.local`), `app config link` (server → toml; no config push — deploy carries config), `app versions list`, `app release <version>` and `app submit`. App commands sign in automatically when there is no valid session (`--no-browser` forces the device code); the 60-minute access token refreshes transparently. In CI, `QUEEK_APP_AUTOMATION_TOKEN` authenticates with no login and 403s name the app + action. `queek.app.toml` (+ `-c/--config` variants) maps exactly to the backend `AppManifestValidator` keys; `handle` is CLI-only sugar for `slug`, secrets in toml are refused. New `@usequeek/create-app` package behind `npm create @usequeek/app`.
