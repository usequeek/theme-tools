---
"@usequeek/cli": patch
---

`queek.app.toml` now refuses a blank label (spaces, tabs or newlines alone) on `date`, `time`, `select` and `submit` fields too, as the server does, so `queek app deploy` fails locally instead of at the server.
