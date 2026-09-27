---
'@usequeek/theme-check': minor
'@usequeek/theme-cli': minor
---

- Reject passing renderMarkdown output to dangerouslySetInnerHTML, which renders "[object Object]" on the page.
- Tune warnings per project with .queek-theme.yml, without ever silencing errors.
- Print the check report with --json and zip details with package --json, keeping exit codes.
- Debug check and package with --verbose lines on stderr.
- Never show the new-version notice in CI or when update checks are opted out.
