---
"@usequeek/create-theme": patch
---

`queek theme add` creates the `demos` folder on Windows too: it built the folder from a `/`-split relative path, and Windows paths use `\`.
