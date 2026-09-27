---
'@usequeek/theme-cli': minor
'@usequeek/theme-check': minor
---

- `queek-theme dev` serves on port 7833 by default, or the next free port up to 7852 when 7833 is busy; a given `--port` stays strict and exits 2 when busy.
- New `queek-theme screenshot` command captures every design's first screen at 1280x800 into the files the checker reads, using Google Chrome, Edge, Playwright's chromium, or QUEEK_THEME_BROWSER.
- The checker's screenshot fixes tell developers to run `npx queek-theme screenshot`, and its preview links use port 7833.
