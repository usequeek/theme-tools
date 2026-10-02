# @usequeek/create-app

Start an installable [Queek](https://usequeek.com) app from the official
[starter](https://github.com/usequeek/queek-app-starter) — the same starter
`queek app init` uses.

## Usage

```
Create a Queek installable app.

  npm create @usequeek/app@latest my-app
  pnpm create @usequeek/app my-app

npm needs -- before these flags. In a terminal, anything you leave out is asked,
and with no folder the folder is named after the slug (my-app with --yes or no terminal).

  --slug <slug>          2-64 lowercase letters, digits or hyphens (default: the folder name)
  --name <text>          display name (default: the slug)
  --pm <npm|pnpm|yarn|bun>, --no-install, --no-git
  --yes, -y              never prompt; take the default for everything else
  --dry-run              print what would be written; write nothing
  --force                allow a folder that is not empty
  --template <source>    another starter: a giget source or a local folder
```

Next: `cd my-app`, `queek auth login`, `queek app dev` (creates a dev store
with test data when you have none).

Every scaffolded app also ships the AI setup verbatim from the starter:
`AGENTS.md` (capacity check via the Queek AI toolkit first, SDK entries,
`queek.app.toml`, dev loop, the live Merchant spec, `queek app codegen`;
"do not add tooling to this repo") and `CLAUDE.md` (`@AGENTS.md`) — the
starter is the single source of truth, the scaffolder never rewrites them —
plus `.mcp.json` + `.cursor/mcp.json`, the wiring location for the Queek
MCP, empty until it publishes. The success banner names it.
