---
"@usequeek/cli": patch
---

- `queek app dev` updates the latest development version in place on every run and every `queek.app.toml` save, instead of creating a new version each time. A new version is created only when the latest one is released or in review, or after you release or bump.
- A version that went to review while `dev` was running is frozen: `dev` says so in one line and continues on the next version.
