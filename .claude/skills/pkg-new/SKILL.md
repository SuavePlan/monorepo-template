---
name: pkg-new
description: Scaffold a new package in this monorepo at packages/<category>/<name>/ with all required files (package.json, tsconfig.lib.json, biome.json, vite.config.ts, vitest.config.ts, src/index.ts, feature module 5-file structure, root README.md). Use when creating a new @suaveplan-ecosystem package from scratch in this repo. Args: "<category>/<name>" e.g. "core/retry", or "<name>" for a flat/uncategorized package.
---

# New Package Scaffolder

Scaffold a complete, gate-ready package from a `<category>/<name>` (or bare `<name>`) spec, following this repo's own `CLAUDE.md` and `openspec/AGENTS.md`.

This repo is a **template**, not the SuavePlan origin monorepo — unlike a `pkg-new` skill living inside `genesis` itself, `@suaveplan/error`, `@suaveplan/testing`, and `@suaveplan/types` are **external published dependencies** here (already root `devDependencies`, resolved from the private Verdaccio registry), not sibling workspace packages. Never reference them as `workspace:^` in a new package's `package.json` — pin the same version range root already uses (`grep '"@suaveplan/' package.json`) and keep it in sync.

Lint/tsconfig/Vite config are different: this repo has its own `@repo/biome-config`, `@repo/typescript-config`, `@repo/vite-config` wrapper packages at `packages/tooling/`, each a thin extension of the matching `@suaveplan/*-config` package (see `CLAUDE.md` §6.5 and `packages/tooling/_intro.md`). New packages extend **these**, not `@suaveplan/*-config` directly — and since they live in this repo's own `packages/` tree, they genuinely are `workspace:^` deps.

## Input

The user provides `<category>/<name>` (or bare `<name>`) as args or in their message, plus what the package does.

If not provided, ask:
> "What package do you want to create? Provide a path like `<category>/<name>` (e.g. `core/retry`), or just `<name>` if it's uncategorized. What does it do?"

## Validation

Before scaffolding:

1. **Category is not fixed in this template** (unlike a from-scratch SuavePlan monorepo with a canonical category list) — run `ls packages/` to see what categories already exist. If `<category>` doesn't exist yet, confirm with the user before creating a new top-level folder under `packages/`; don't invent one silently.
2. Confirm the target path `packages/<category>/<name>/` does NOT already exist.
3. **An OpenSpec change is required for every package scaffolded with this skill** (`CLAUDE.md` §2) — no exceptions for product/capability packages. Confirm `openspec/changes/` contains a relevant entry with `proposal.md`, `tasks.md`, and a spec delta under `specs/<capability>/spec.md`. If missing, create it first (don't just ask and proceed without one) — the package's own `proposal.md` should carry a `**Package**: @suaveplan/<name>` frontmatter line so `scripts/openspec/conformance.ts` can match it. The only carve-out is this repo's own `packages/tooling/*` config-wrapper packages (`@repo/biome-config`, `@repo/typescript-config`, `@repo/vite-config`) — those were scaffolded once as foundational infrastructure without OpenSpec docs, by explicit user direction; that carve-out does not extend to anything else.
4. Decide the **tier** — universal (zero browser/Node deps), browser (React/DOM ok), or server (Node.js ok) — per `CLAUDE.md` §16. This drives which `tsconfig` variant and `package.json` shape you use below. `scripts/manifest/generate-manifest.ts` infers tier automatically from these same signals (React peer dep/`browser` field → browser; `bin` field or a server-dependency hint → server; else universal) — pick the variant that matches how the package will actually be classified.
5. Confirm the npm scope. This template ships `@suaveplan/*` foundation tooling as devDependencies; if the project hasn't been rebranded to a different scope, new packages typically stay in the `@suaveplan/` namespace for ecosystem consistency — confirm with the user rather than assuming.

## Files to Create

For a package `@suaveplan/<name>` at `packages/<category>/<name>/`:

### `package.json`

```json
{
  "name": "@suaveplan/<name>",
  "version": "0.1.0",
  "description": "<one-line description>",
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./package.json": "./package.json",
    "./<feature>/<feature>": {
      "import": {
        "types": "./dist/<feature>/<feature>.d.ts",
        "default": "./dist/<feature>/<feature>.js"
      }
    }
  },
  "scripts": {
    "build": "vite build",
    "lint": "bunx biome check src/",
    "typecheck": "tsc --noEmit -p tsconfig.lib.json",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "docs:check": "bun ../../../scripts/docs/docs-check.ts ."
  },
  "dependencies": {
    "@suaveplan/error": "^0.1.0",
    "tslib": "catalog:"
  },
  "devDependencies": {
    "@suaveplan/testing": "^0.1.0",
    "@suaveplan/biome-config": "^0.1.5",
    "@repo/typescript-config": "workspace:^",
    "@repo/vite-config": "workspace:^",
    "@repo/biome-config": "workspace:^",
    "vite": "catalog:build",
    "vitest": "catalog:testing",
    "@vitest/coverage-istanbul": "catalog:testing",
    "typescript": "catalog:"
  }
}
```

- One `exports` subpath **per feature module** (`CLAUDE.md` §6.3) — add one for every folder under `src/`, not just a single `"."` barrel. `dist/<feature>/<feature>.js` exists per-module because `@repo/vite-config`'s `defineLibConfig` (itself forwarding to `@suaveplan/vite-config`) builds with `preserveModules: true`.
- `docs:check` path depth (`../../../scripts/...`) must match the actual nesting of `packages/<category>/<name>/` — adjust `../` count if the layout is flatter or deeper.
- Adjust deps to what the package actually needs; remove unused ones. `@repo/*` wrappers and any other package living in *this repo's own* `packages/` tree are `workspace:^`; `@suaveplan/*` foundation packages (`error`, `testing`, `types`, and — for `biome.json` specifically, see below — `biome-config`) are external and pinned.

### `tsconfig.lib.json`

```json
{
  "extends": "@repo/typescript-config/library.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

Swap the `extends` target by tier: `library.json` (universal), `library-browser.json` (browser), `library-node.json` (server), `react-library.json` (React components).

### `biome.json`

```json
{
  "extends": ["@suaveplan/biome-config/biome.json", "@repo/biome-config/biome.json"],
  "root": false
}
```

**Both entries are required, in that order.** Biome's `extends` is not transitive — a config reached via `extends` does not itself get to process its own `extends` field — so `@repo/biome-config/biome.json` cannot wrap `@suaveplan/biome-config` the way `@repo/typescript-config` and `@repo/vite-config` do. It's a standalone overrides fragment instead; listing it after the upstream entry lets its rules win on conflict. See `packages/tooling/biome-config/README.md` for the verified detail. Don't "simplify" this to a single `@repo/biome-config` entry — that silently drops every upstream rule.

### `vite.config.ts`

```ts
import { defineLibConfig } from "@repo/vite-config";

export default defineLibConfig(__dirname);
```

Override `entry`/`bundle`/`plugins` only if the package needs something beyond the `src/index.ts` default — see the package's own README for the override shape.

### `vitest.config.ts`

```ts
import { createTestConfig } from "@suaveplan/testing/config";

export default createTestConfig();
```

Pass `{ environment: "happy-dom", fileParallelism: false }` for browser-tier packages; `{ testTimeout: 30_000, hookTimeout: 60_000 }` for async/IO-heavy (integration, testcontainers) packages.

### `src/index.ts`

Barrel with explicit named re-exports from every feature module (never `export *` — `CLAUDE.md` rule 10). If `src/error-codes.ts` exists, it MUST also contain the bare side-effect import `import "./error-codes.js";` — `scripts/openspec/conformance.ts` checks this.

### `src/<feature-name>/` (one folder per feature)

Five files, matching the folder name exactly (`CLAUDE.md` §6.1, enforced by `scripts/lint/check-feature-layout.ts`):

- `index.ts` — barrel, explicit named re-exports
- `<feature-name>.ts` — implementation
- `<feature-name>.test.ts` — tests, import from `@suaveplan/testing/runner` (never `vitest`/`bun:test` directly — rule 11)
- `<feature-name>.types.ts` — type definitions (optional)
- `<feature-name>.md` — co-located docs, ≥200 words, with Purpose / Features / Usage: Basic Example / Usage: Advanced Example / API Reference / Implementation Notes (`CLAUDE.md` §11.1 — checked by `scripts/docs/docs-check.ts`)

### `src/error-codes.ts` (only if the package has error conditions)

```ts
import { defineCodes, SuaveplanError } from "@suaveplan/error";

export const <PKG_UPPER>_CODES = defineCodes("<PKG_UPPER>", [
  "REASON_A",
  "REASON_B",
] as const);

export class <PkgName>Error extends SuaveplanError<
  (typeof <PKG_UPPER>_CODES)[keyof typeof <PKG_UPPER>_CODES]
> {}
```

`defineCodes` takes an **array of reason strings**, not an object literal — confirm against `@suaveplan/error`'s actual `README.md` in `node_modules` if unsure. Needs a sibling `error-codes.md`. Every registered code must be thrown from a real call site exercised by a test (`CLAUDE.md` §13) — `conformance.ts` flags a declared-but-unused code.

### Root `README.md`

Per `CLAUDE.md` §11.4: H1 package name, one-paragraph description, install command, quick-start example. Leave the "Documentation tree" / "Submodules" sections alone — `scripts/docs/generate-package-module-tree.ts` injects those automatically between auto-docs markers when you run `docs:generate` below. Don't hand-write them.

## Test File Template

```ts
import { describe, expect, it } from "@suaveplan/testing/runner";

describe("<FeatureName>", () => {
  it("<describes the behavior, not the implementation>", { timeout: 5000 }, () => {
    // ...
  });
});
```

## After Scaffolding

```bash
bunx turbo lint typecheck test --filter=@suaveplan/<name>
bunx turbo test:coverage --filter=@suaveplan/<name>
bunx turbo build --filter=@suaveplan/<name>
```

Then regenerate the repo-wide artifacts (these pick up the new package automatically — no need to hand-edit `packages/<category>/_intro.md`, category `README.md`, `packages/README.md`, or root `README.md`):

```bash
bun scripts/manifest/generate-manifest.ts
bun scripts/docs/generate-all-docs.ts
```

If this is the first package in a brand-new category, `docs/ensure-category-intros.ts` (run as part of `generate-all-docs.ts`) seeds a placeholder `_intro.md` for it — replace the placeholder prose with something real.

## Rules Checklist

Before finishing, confirm:

- [ ] No `export *` in any feature barrel (rule 10)
- [ ] Test files import from `@suaveplan/testing/runner`, not `vitest`/`bun:test` (rule 11)
- [ ] No suppression comments — `biome-ignore`, `eslint-disable*`, `ts-ignore`, `ts-expect-error` (rule 9)
- [ ] Every implementation `.ts` file has a sibling `.md` with all required sections and ≥200 words (§11.1)
- [ ] One `exports` subpath per feature module in `package.json`, not just `"."` (§6.3)
- [ ] `@suaveplan/*` foundation deps (`error`, `testing`, `types`) are pinned versions, **not** `workspace:^`; `@repo/*-config` deps **are** `workspace:^` (this repo is a template, not the origin monorepo — only the local wrapper packages are truly internal)
- [ ] `{ timeout: 5000 }` (or higher for async-heavy) on every `it()`/`test()`
- [ ] `sideEffects: false` in `package.json`
- [ ] `src/index.ts` side-effect-imports `./error-codes.js` if that file exists
- [ ] `bunx turbo lint typecheck test build --filter=<pkg>` and `bunx turbo test:coverage --filter=<pkg>` are green (§10.3 pre-publish gate)
