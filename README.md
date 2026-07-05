# monorepo-template

SuavePlan monorepo template — scaffolds a Bun + Turbo + Biome monorepo

Bun + Turborepo + Biome monorepo template. Drop an `_intro.md` at the repo root to replace this default header.

## Stack

- **Monorepo orchestrator**: Turborepo
- **Package manager / runtime**: Bun
- **Lint / format**: Biome
- **Unit tests**: Vitest
- **E2E**: Playwright
- **Language**: TypeScript (strict)

## Workspace layout

- [`apps/`](./apps/) — deployable applications.
- [`packages/`](./packages/) — library packages, grouped by category (`packages/<category>/<pkg>/`).
- [`e2e/`](./e2e/) — end-to-end test suites.

## Companion docs

- [`CLAUDE.md`](./CLAUDE.md) — engineering standards and AI-agent contract.
- [`openspec/AGENTS.md`](./openspec/AGENTS.md) — the change-proposal workflow.
- [`packages/README.md`](./packages/README.md) — auto-generated package index.

<!-- begin:auto-docs -->
## Packages by category

No packages yet. Scaffold your first package under `packages/<category>/<pkg>/`, then run `bun scripts/docs/generate-all-docs.ts` to populate this section.
<!-- end:auto-docs -->
