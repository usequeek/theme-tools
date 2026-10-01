---
'@usequeek/cli': patch
---

Review fixes (REVISE → address): hermetic `GITHUB_ACTIONS` handling in the
codegen tests (both CI-shaped and local cases pin the variable they need, so
the suite passes identically with and without `GITHUB_ACTIONS=true CI=true`);
`[access] optional_scopes` round-trip support in the toml mirror/mapping
(requested post-install, never granted at install, disjoint from `scopes`;
`scopes` may now be empty per the backend `present,array` rule; dashboard
action scopes resolve against either tier); a sorted-keys snapshot of the
28-key manifest mirror plus the `extensions` sub-keys that fails loudly on
backend `AppManifestValidator::topLevelKeys()` drift; one shared
`ensureQueekIgnored()` helper (init/dev/deploy) so `.queek/` is actually
gitignored, not just called that; 0600 on the deploy-written `.env.local`;
toml-watcher burst coalescing in the deploy queue; and a comment aligning the
unreachable-per-supervision `MAX_TUNNEL_RESTARTS=5` with the 3-per-10-minutes
window cap.

Ordering: this CLI release must ship AFTER the backend optional-scopes push
(`scopes` present-but-empty + `optional_scopes` in `AppManifestValidator`) —
against the older backend, `optional_scopes` deploys 422 and empty `scopes`
is refused server-side.
