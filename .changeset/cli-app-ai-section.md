---
"@usequeek/cli": patch
---

`queek app deploy`, `queek app dev` and `queek app config link` accept the `[ai]` section of `queek.app.toml` (`summary`, `[[ai.tools]]`, `[[ai.actions]]`) instead of refusing it as an unknown field. The section is sent to the API as written and `app config link` writes it back; only its shape is checked locally (an unknown key inside `[ai]` fails with the API's wording), the API validates the rest. First-party app pages are now `{app}.apps.queek.app` hosts.
