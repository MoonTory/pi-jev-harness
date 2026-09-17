Copied from the adminty repo's `lint/oxlint-rules` (itself forked from https://github.com/dmmulroy/anti-slop, MIT, LICENSE kept), minus the rules that only make sense for adminty's UI packages.

Owned by this repo: rules here are curated — remove or add rules freely; config in .oxlintrc.json.
Excluded from self-linting by the root `lint/oxlint-rules/**` ignore, so `src/vendor/**` needs no
separate ignore entry. Everything outside `src/vendor/**` is formatted with repo prettier;
`.prettierignore` keeps the vendored directory in upstream formatting so future diffs stay readable.

Added rules:

- `consistent-control-size`: restricts control `size` props to the vocabulary configured for their area.
- `no-export-star`: requires every re-export to name its public symbols.
- `no-server-in-browser-graph`: keeps server-only modules out of browser source graphs.
- `no-raw-interactive-elements`: keeps kit screens on the shared UI primitives.
- `no-base-ui-outside-ui`: keeps Base UI inside `@adminty/ui`.

Pulled from upstream:

- `no-reduce-accumulator-copy`: rejects growing reducer accumulator copies.
- `require-readable-spacing`: reuses upstream's vendored ESLint Stylistic
  `padding-line-between-statements` (`src/vendor/eslint-stylistic/`, MIT, license kept) but carries
  this repo's policy from AGENTS.md § Readability and visual structure. It separates the import
  block, top-level statements, and `function`/`class`/`interface`/`type` declarations. Upstream's
  before-control-flow, after-`block-like`, and multiline-binding entries are dropped: they split
  related guards, which AGENTS.md requires to stay together as one group. A run of re-exports is
  exempt like a run of imports, so barrels stay dense.

Removed rules:

- `no-runtime-typeof`: hand-rolled wire-boundary guards are deliberate.
- `no-conditional-empty-object-spread`: conditional spreads preserve `exactOptionalPropertyTypes` semantics.
- `no-unknown-parameters`: hand-rolled wire-boundary guards are deliberate.
- `no-unknown-returns`: hand-rolled wire-boundary guards are deliberate.
- `no-reflect-get`: cast-free `Reflect` reads are deliberate.
- `no-unsafe-dictionary-type`: `adminty/no-erased-record-types` governs dictionary types.
- `no-object-parameters`: `adminty/no-erased-record-types` governs row and object types.
- `no-known-value-widening`: wide annotations are deliberate where owner contracts require them.
- `no-array-filter-map`: the rewrites it demands read worse on the micro-lists this repo builds.

Also left upstream:

- The `anti-slop-effect` plugin: it overlaps `no-nested-ternary` and this repo's own error taxonomy.
- `require-readable-spacing-cli.test.ts`: it spawns the Oxlint CLI; the RuleTester cases prove the policy.

`no-module-mocking` is deferred pending a test-seam round.
