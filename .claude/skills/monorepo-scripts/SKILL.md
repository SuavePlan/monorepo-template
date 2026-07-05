---
name: monorepo-scripts
description: Reference for this repo's root scripts/ tooling — the OpenSpec/CLAUDE.md lint gates, doc generators, and manifest generator. Use before running or diagnosing a `bun run lint*`/`docs:*`/`manifest:*`/`conformance` command, when a gate fails and its rule isn't obvious from the error alone, when adding a new package (to know which generators to re-run), or before proposing a new lint check (one may already exist here).
---

Full per-script detail (flags, reads/writes, exit codes) lives in `scripts/README.md` — read it when you need specifics. This skill is the fast lookup: which script owns which rule, and the gotchas that aren't obvious from the error message alone.

## Fast lookup: symptom → script

| If... | It's enforced by | Fix by |
|---|---|---|
| "test-runner-imports" lint fails | `lint/check-test-runner-imports.ts` | import from `@suaveplan/testing/runner`, not `vitest`/`bun:test` directly |
| "feature-layout" lint fails | `lint/check-feature-layout.ts` | move the file so its parent dir name matches the file's base name |
| "cross-package-contracts" lint fails | `lint/check-cross-package-contracts.ts` | move the shared interface/type into a designated contract package, or add `// @cross-package-contract` above the declaration if it's a false positive |
| "conformance-tests" lint fails | `lint/check-conformance-tests.ts` | add a `tests/conformance/*.test.ts` importing the contract package's `/testing` export |
| "carry-forward-deps" lint fails | `lint/check-carry-forward-deps.ts` | a `tasks.md` gate row cites a still-open gate as its carry-forward source — finish that gate first |
| "verified-by" lint fails | `lint/check-verified-by.ts` | add a `**Verified by:**` test citation or `**Verified by (gate):**` line to the spec requirement |
| "stage-smoke" lint fails | `lint/check-stage-smoke.ts` | add the missing `N.0` e2e/stage-smoke row to that Stage block in `tasks.md` |
| "primitive-host-integration" lint fails | `lint/check-primitive-host-integration.ts` | add the missing `## Concrete consumer` / `## Host bridge` / `## End-to-end test` section to `proposal.md` |
| "preflight" lint fails | `openspec/check-preflight.ts` | restore Section 0 boilerplate in `tasks.md` from `openspec/templates/tasks.md` |
| "docs-tree" lint fails / README looks stale | `docs/generate-all-docs.ts --check` | run `bun run docs:generate` to rewrite, then commit |
| `conformance` reports missing Verified-by / unused error code / unparsed schema / public `unknown` | `openspec/conformance.ts` | see its six checks in `scripts/README.md`; this is the deep implementation↔spec check, separate from `check-verified-by.ts`'s shallower spec-only scan |
| adding a brand-new package | — | run `bun run manifest:generate` and `bun run docs:generate` afterward so `MANIFEST.md`, category/root READMEs, and module trees pick it up |

## Gotchas

- **Empty JSON configs are intentional, not dead code.** `lint/contract-packages.json`, `lint/primitives.json`, and `lint/feature-layout-baseline.json` all ship `[]` because this is a fresh template with no packages yet — each gate is designed to degrade to a no-op until populated. Don't "clean up" an empty array without checking whether it should instead be populated for the package you're adding.
- **`check-feature-layout.ts` is a ratchet, not a hard gate.** Only *new* violations fail the build; pre-existing ones recorded in `feature-layout-baseline.json` print as warnings. `--update-baseline` rewrites that file from the current violation set — only run it deliberately (it silently grandfathers whatever exists at that moment).
- **Exit code `2` means "usage/internal error," not "rule violated."** `check-test-runner-imports.ts`, `check-verified-by.ts` (bad `--mode=`), `conformance.ts` (no target/`--all`), and the `docs/generate-*.ts` scripts (missing `packages/` root) all use `2` for this. Exit `1` is a real violation.
- **`check-verified-by.ts --mode=archive`'s cited-file-exists check is currently a documented no-op** (its `pkgRootOf()` resolver always returns `undefined`, pending a future package-root map) — don't treat "archive mode passed" as proof the cited test still exists.
- **`docs/generate-all-docs.ts` in write mode is fail-fast; in `--check` mode it is not** — check mode runs every layer and reports all drift at once before exiting non-zero.
- **`scripts/` itself is exempt from the package doc-tree gate.** `docs-check.ts` and the `generate-*.ts` family only operate on `packages/*`, `apps/*`, `e2e/*` — a script added here doesn't need a sibling `.md` (this `SKILL.md` + `scripts/README.md` are the docs for this directory).
- **`discoverPackageDirs()` (`lib/discover-packages.ts`) is the one shared package-enumeration primitive** nearly every script here depends on. If you're adding a new lint/doc script that needs to enumerate packages, use it instead of hand-rolling a directory walk.
