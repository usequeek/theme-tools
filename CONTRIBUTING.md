# Contributing to theme-tools

Thanks for helping build Queek's theme tooling. This guide covers setup, how to
make changes, and what we expect in a pull request.

## Prerequisites

- Node.js `>=22.12.0` (see `.nvmrc`; `engines.node` is enforced per package)
- Corepack (ships with Node) and pnpm `12.6.0` (via the `packageManager` field)

## Setup

```sh
corepack enable
pnpm install
```

Then verify everything works:

```sh
pnpm build      # build every workspace package (tsc per package)
pnpm test       # run the vitest suite
pnpm lint       # eslint over the whole repo
pnpm typecheck  # tsc --noEmit per package
```

`pnpm publint` additionally checks that each built package packs correctly
(`publint --strict` per package).

## Repo layout

This is a pnpm workspaces monorepo (`pnpm-workspace.yaml` → `packages/*`).

| Path | Package | What it is |
|---|---|---|
| `packages/theme-cli` | `@usequeek/theme-cli` | The `queek-theme` CLI: `dev`, `check`, `package`, `init` |
| `packages/theme-check` | `@usequeek/theme-check` | Theme validator library (the check rules live here) |
| `packages/create-theme` | `@usequeek/create-theme` | Scaffolder, run via `npm create @usequeek/theme` |
| `packages/theme-cli/preview` | — | The preview app `queek-theme dev` serves (TypeScript source, compiled to `templates/preview` as plain JavaScript by `pnpm build`) |
| `fixtures/starter` | — | A theme project as a developer has it (the Queek skeleton theme), used by the tests |
| `scripts/e2e.mjs` | — | End-to-end test: packs the packages, installs them into a fresh project outside the repo, runs `check`, `package` and `dev` |
| `.changeset/` | — | Changesets config and pending version bumps |

Shared build config lives in `tsconfig.base.json`, `eslint.config.js`, and
`vitest.config.ts` at the repo root.

## Running the CLI locally

Build the workspace, then run the freshly built CLI against a fixture theme
directory:

```sh
pnpm build
node packages/theme-cli/bin/run.js check --path fixtures/starter
node packages/theme-cli/bin/run.js package --path fixtures/starter --output /tmp/theme.zip
```

`dev` needs a real theme project: Turbopack only resolves files inside the
project root, and the fixture's dependencies live at the monorepo root, above
it. `pnpm e2e` runs the whole developer journey — `dev` included — from packed
tarballs installed into a fresh project, the way npm would install them. Run it
before any change to packaging, the preview or the CLI's dependencies. If you are iterating on a rule in `@usequeek/theme-check`, rebuild
(`pnpm build`) before re-running the CLI so it picks up your change.

## Changesets: required for package changes

Every PR that changes anything inside a `packages/*` directory **must** include
a changeset:

```sh
pnpm changeset
```

Pick the affected package(s) and the bump type (see the SemVer table below),
and write a short summary of the user-visible change. CI does not enforce this
automatically — reviewers will ask for it, and the release workflow consumes
it. Docs-only or repo-chore PRs (workflows, templates, this file) need no
changeset.

## SemVer: what counts as major / minor / patch

We follow Semantic Versioning per package. Use this table when choosing a
changeset bump for `@usequeek/theme-cli` (and, by analogy, the other
packages):

| Bump | CLI change |
|---|---|
| **major** | Removing or renaming a command or flag; changing process exit codes; changing the shape of machine-readable JSON output |
| **minor** | Adding a new command, flag, or check rule; any new backwards-compatible capability |
| **patch** | Bug fixes and internal refactors with no behaviour change |

A **new blocking check rule** is a `minor` bump (it is backwards-compatible in
API terms), but call it out explicitly in the changeset summary so theme
authors are not surprised when `queek-theme check` starts failing on themes
that used to pass — e.g. "`check` now errors on …".

## Commit and PR expectations

- Keep PRs small and focused: one change, one changeset, one topic.
- Write commits in the imperative mood with a clear subject line
  (e.g. `Add --strict flag to queek-theme check`).
- Explain the *why*, not just the *what*, in the PR description
  (the PR template prompts for this).
- Add or update tests for behaviour changes, and update the relevant
  `README.md` when user-facing behaviour changes.
- Make sure `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm typecheck`
  all pass before requesting review.
- Be kind and assume good intent, per our
  [Code of Conduct](CODE_OF_CONDUCT.md).

## AI-assisted contributions

AI coding assistants are welcome here, under the same bar Storybook sets for
its contributors:

1. **You must understand and be able to explain every line you submit.**
   If a reviewer asks why a line exists and the answer is "the AI wrote it",
   the PR is not ready. Read the diff, trace the logic, and own it.
2. **Never let an AI speak for you.** Reviewer questions, design discussion,
   and issue threads need your words and your judgement, not pasted model
   output.
3. **Keep AI-generated diffs tight.** Models tend to refactor the world;
   trim the change to the smallest diff that solves the problem, matching the
   surrounding code style.
4. **Disclose AI use in the PR.** Tick the AI-disclosure checkbox in the PR
   template and briefly say what the AI did (e.g. "used an AI assistant to
   draft the rule implementation; I reviewed, tested, and edited it").

Fully AI-generated PRs the author cannot explain will be closed.
