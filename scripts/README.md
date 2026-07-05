# `scripts/`

Root-level tooling — not a workspace package, so it's exempt from the `packages/` doc-tree gate and the per-file sibling-`.md` rule in `CLAUDE.md` §11. These scripts enforce the OpenSpec/CLAUDE.md engineering rules and generate documentation/manifest artifacts across the monorepo. Everything here runs via `bun scripts/<path>.ts`, almost always through a `package.json` alias.

## Quick reference

| `package.json` script | File |
|---|---|
| `lint:test-runner-imports` | `lint/check-test-runner-imports.ts` |
| `lint:feature-layout` | `lint/check-feature-layout.ts` |
| `lint:cross-package-contracts` | `lint/check-cross-package-contracts.ts` |
| `lint:conformance-tests` | `lint/check-conformance-tests.ts` |
| `lint:carry-forward-deps` | `lint/check-carry-forward-deps.ts` |
| `lint:verified-by` / `lint:verified-by:archive` | `lint/check-verified-by.ts --mode=author\|archive` |
| `lint:stage-smoke` | `lint/check-stage-smoke.ts` |
| `lint:primitive-host-integration` | `lint/check-primitive-host-integration.ts` |
| `lint:preflight` | `openspec/check-preflight.ts` |
| `lint:docs-tree` | `docs/generate-all-docs.ts --check` |
| `docs:generate` | `docs/generate-all-docs.ts` |
| `manifest:generate` / `manifest:check` | `manifest/generate-manifest.ts [--check]` |
| `conformance` | `openspec/conformance.ts` |
| *(no alias yet)* | `docs/analyze-doc-tree.ts`, `docs/docs-check.ts` |

All lint scripts are read-only checks: exit `0` clean, `1` on violation (a couple use `2` for usage/internal errors — noted per-script below). The `docs:generate` / `manifest:generate` scripts write files; passing `--check` makes them read-only and diff-only.

---

## `lib/` — shared helpers (not invoked directly)

- **`config.ts`** — exports `CONFIG`: repo root/`packages` path, Verdaccio registry settings, the `testing.exemptRunnerWrapperPackages` allowlist, coverage thresholds (100/100), and `exitCodes`. Single source of truth most other scripts import from.
- **`discover-packages.ts`** — exports `discoverPackageDirs()`, the one shared package-enumeration primitive. Walks `packages/<category>/<pkg>/` (canonical 2-level), falling back to flat or 3-level layouts. Nearly every script below uses this instead of hand-rolling directory walks.
- **`doc-tree.ts`** (+ `doc-tree.test.ts`) — markdown-tree utilities used only by the `docs/generate-*.ts` generators: auto-docs marker constants, idempotent marked-section replacement (with leaked-trailer cleanup from a past bug), first-paragraph extraction, relative-link parsing, canonical-doc selection.

## `docs/`

- **`analyze-doc-tree.ts`** — BFS-crawls linked `.md` files from the root `README.md` and diffs against every `.md` on disk to report **orphans** (unreachable) and **broken** (linked but missing) docs. Read-only. `--strict` (fail on findings; default is warn-only), `--quiet`/`-q` (one-line summary), `--ignore <segment>` (repeatable).
- **`docs-check.ts`** — verifies every non-exempt `.ts(x)` under a package's `src/` has a sibling `.md` with the required sections (Purpose, Features, Usage, API Reference, Implementation Notes) and ≥200 words. Takes one positional `[<package-dir>]` arg (default `.`). Not yet wired to a root `package.json` alias — run per-package or from a package's own `docs:check`.
- **`ensure-category-intros.ts`** — writes a placeholder `packages/<category>/_intro.md` for any category with ≥1 real package but no intro file yet. Never overwrites an existing one.
- **`generate-all-docs.ts`** — orchestrates the five generators below in dependency order (intros → module tree → category READMEs → packages root README → repo root README). `--check` runs every layer and reports all drift (not fail-fast); write mode is fail-fast and re-runs the module-tree step up to 5 times to reach a fixed point. `--verbose` extra logging.
- **`generate-category-readmes.ts`** — writes `packages/<category>/README.md` (header from `_intro.md`, body = auto-generated package table). Skips categories with zero packages. `--check`.
- **`generate-package-module-tree.ts`** — builds each package's `src/` doc tree and injects "Documentation tree" / "Submodules" auto-docs sections into READMEs and per-folder `.md` files, plus an OpenSpec-spec-link footer. `--check`, `--verbose`/`-v`.
- **`generate-packages-root-readme.ts`** — writes `packages/README.md` with one section per category. `--check`.
- **`generate-root-readme.ts`** — rebuilds the repo root `README.md` (header from root `_intro.md` or a generated default, body = packages-by-category table). `--check`.

## `lint/`

OpenSpec/CLAUDE.md rule gates. All read-only; all fail with exit `1` on violation unless noted.

- **`check-carry-forward-deps.ts`** — a `tasks.md` gate row marked "carry forward from gate 2.X" may not depend on another still-open gate row (or a nonexistent one).
- **`check-conformance-tests.ts`** — any package that depends on a "contract" package (one exporting `./testing` with a `run<X>Conformance` function) must have its own conformance test importing it, unless opted out via `package.json#conformanceSkip`.
- **`check-cross-package-contracts.ts`** — a type/interface `implements`-ed across package boundaries must live in a designated contract package (see `contract-packages.json` below), unless the declaration line has a `// @cross-package-contract` comment.
- **`check-feature-layout.ts`** — enforces one-folder-per-file under `src/` (parent dir name must equal the file's base name), with standard exemptions (`index.ts`, `.test/.spec/.types/.stories`, `types/`, `utils/`, `constants/`, etc.). Ratchet-gated: only *new* violations fail; pre-existing ones in `feature-layout-baseline.json` print as non-blocking warnings. `--update-baseline` (rewrite the baseline from current violations, write-only), `--show-grandfathered`.
- **`check-primitive-host-integration.ts`** — for OpenSpec proposals matching a registered "primitive" (see `primitives.json`), requires `## Concrete consumer`, `## Host bridge` (if `requiresBridge`), and `## End-to-end test` sections in `proposal.md`.
- **`check-stage-smoke.ts`** — every `### Stage N` block in a `tasks.md` must include an `N.0` closure-smoke row referencing `e2e/` and `stage-`.
- **`check-test-runner-imports.ts`** — no package (unless listed in `CONFIG.testing.exemptRunnerWrapperPackages`) may `import` directly from `"vitest"` or `"bun:test"` under `src/`; must go through `@suaveplan/testing/runner`. `--root <path>` override. Exits `2` on internal error (e.g. unparsable `package.json`), not just `1`. Companion `.test.ts` exercises the exported `findViolations`/`formatViolations` against temp fixture packages.
- **`check-verified-by.ts`** — every `### Requirement:` in a spec delta needs a `**Verified by:**` test citation or an explicit `**Verified by (gate):**` line naming a concrete mechanism. `--mode=author` (default; `openspec/changes/`, syntax-only) vs `--mode=archive` (`openspec/archive/`; cited files should also exist — currently a documented no-op pending a package-root resolver). Bad `--mode=` value exits `2`. Companion `.test.ts` exercises the exported `scanSpec`.

**Config files** (all currently empty — this is a fresh template with no packages yet, so each gate degrades to a no-op until populated):

- `contract-packages.json` — array of package **directory basenames** recognized as contract packages (exempt from `check-cross-package-contracts.ts`).
- `feature-layout-baseline.json` — `{ description, violations: string[] }`, the `check-feature-layout.ts` ratchet baseline.
- `primitives.json` — array of `{ name, requiresBridge?, bridgePackagePattern? }` consumed by `check-primitive-host-integration.ts`.

## `manifest/`

- **`generate-manifest.ts`** — generates root `MANIFEST.md`: a packages table (name/category/tier/version/workspace-dep count/description), a tier overlay (universal/browser/server, inferred from peer deps, `bin`, `engines`, and a hardcoded server-dependency hint list), and a Graphviz DOT workspace dependency graph. `--check` (exit `1` on drift), `--stdout` (print only, no write, ignores `--check`).

## `openspec/`

- **`check-preflight.ts`** — every unarchived change's `tasks.md` must contain the canonical "Section 0: Pre-flight" boilerplate (worktree-list + `.claude/worktrees` references).
- **`conformance.ts`** — the deepest gate: checks that a package's implementation actually matches its OpenSpec contract — spec-requirement Verified-by coverage, every registered error code is referenced, every `src/schemas/` export is `.parse`/`.safeParse`d somewhere, no public `: unknown` in built `.d.ts`, `error-codes.ts` is side-effect-imported from `index.ts`, and no unrectified "retroactively ticked" tasks. Takes one or more positional package name/path targets, or `--all`; `--json` for machine-readable output. No target and no `--all` exits `2`.

---

### Notes for maintainers

- `discoverPackageDirs()` (`lib/discover-packages.ts`) is the one package-enumeration primitive almost everything else builds on — extend it, don't duplicate it, if a new workspace layout shows up.
- Exit codes aren't fully uniform: most scripts use `0`/`1`; `check-test-runner-imports.ts` and `check-verified-by.ts` use `2` for internal/usage errors; `conformance.ts` uses `2` for missing-target usage errors; several `docs/` generators use `2` when `packages/` itself is missing.
- The three empty lint configs (`contract-packages.json`, `primitives.json`, `feature-layout-baseline.json`) are intentional for a fresh template — populate them as real packages land, don't treat the empty array as dead code to delete.
