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

3 packages across 1 category. Each row links to the category's own README, which in turn lists every package and its first-paragraph description.

| Category | Packages |
|---|---:|
| [`tooling`](./packages/tooling/README.md) | 3 |
<!-- end:auto-docs -->
