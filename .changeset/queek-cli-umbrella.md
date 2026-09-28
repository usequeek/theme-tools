---
'@usequeek/cli': minor
'@usequeek/theme-cli': minor
'@usequeek/theme-check': patch
'@usequeek/create-theme': minor
---

New `queek` CLI: `queek theme dev|check|screenshot|package|init` (install
`@usequeek/cli`). The theme commands live in `@usequeek/theme-cli`, which
`queek-theme` remains as an alias of — it prints `` `queek-theme` is now
`queek theme` `` to stderr. The starter switches to `@usequeek/cli`.
`theme-check` fix texts name `npx queek theme screenshot`.
