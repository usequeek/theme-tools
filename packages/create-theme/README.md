# @usequeek/create-theme

Start a theme for [Queek](https://usequeek.com) storefronts from the official
[starter](https://github.com/usequeek/theme-starter).

## Usage

```
Create a Queek storefront theme.

  npm create @usequeek/theme@latest my-theme -- --templates laundry --tags minimal
  pnpm create @usequeek/theme my-theme --templates laundry --tags minimal

npm needs -- before these flags. In a terminal, anything you leave out is asked.

  --name <text>          theme name (default: the folder name)
  --templates <keys>     businesses to make templates for, comma-separated (required with --yes)
  --primary <key>        the primary template (default: the first)
  --categories <keys>    business categories (default: the templates')
  --tags <tags>          1–6 tags for the look (required with --yes)
  --pages <list|none>    extra pages: contact, faq (default: both)
  --ai <list>, --no-ai   AI assistants: claude, gemini (default: both; AGENTS.md unless --no-ai)
  --pm <npm|pnpm|yarn|bun>, --no-install, --no-git
  --yes, -y              never prompt; take the default for everything else
  --dry-run              print what would be written; write nothing
  --force                allow a folder that is not empty
  --template <source>    another starter: a giget source or a local folder
```

The starter is pinned to the tag matching this package's version. Everything is written into a temporary folder and moved into place at the end.

## What you get

Right after `create`, `npm run check` rejects exactly your to-do list. For a one-template theme that is four rules: `theme/placeholder-content` (the starter's placeholder products and photos, and the theme's placeholder description), `theme/structure` and `theme/template-screenshot` (each template's screenshot), and `theme/template-description` (each template's description). With two or more templates, `theme/template-versions` is added: each template must have its own home page.

The target folder must be missing, empty, or hold only `.git`. The `--force` flag allows writing into another folder but refuses file-or-folder clashes and symlinks at paths the starter writes. A regular file at the target path is always refused.

## License

MIT
