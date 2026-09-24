---
'@usequeek/theme-cli': patch
---

Commands now load on Windows. The CLI found its commands by scanning its own folder at runtime, which found none on Windows ("command check not found"); they are now listed explicitly.
