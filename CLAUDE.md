# {{PROJECT_NAME}} Monorepo — Engineering Standards

Engineering rulebook for AI coding agents and human contributors working in this repo. Adapted from the SuavePlan Genesis house style, trimmed to this project's scale. `<pkg>` placeholders throughout refer to whatever package you're currently working on under `apps/`, `packages/`, or `e2e/`.

---

## 1. Stack baseline

- **Monorepo orchestrator**: Turborepo.
- **Package manager / runtime**: Bun.
- **Lint / format**: Biome.
- **Unit tests**: Vitest.
- **E2E**: Playwright.
- **Language**: TypeScript, strict.
- **Registry**: private Verdaccio (auth via `NPM_TOKEN` in `.env`).

Pin every tool version in the root manifest; never accept "latest" implicitly.

---

## 2. Change workflow

All non-trivial changes go through the **OpenSpec** process (see `openspec/AGENTS.md`). Before coding:

1. Read the project's spec/agents docs.
2. Create `openspec/changes/<change-id>/` with `proposal.md`, `tasks.md`, and spec deltas under `specs/<capability>/spec.md` using `## ADDED` / `## MODIFIED` / `## REMOVED Requirements` headings.
3. On ship: fold the delta into `openspec/specs/<capability>/spec.md` and move the folder to `openspec/archive/<yyyy-mm-dd>-<change-id>/`.

---

## 3. Critical rules (never compromise)

1. **Never run `tsc` directly.** Use your bundler (Vite/tsup/esbuild) via your task runner. Native TS runtimes (Bun, ts-node) execute `.ts` files without compilation.
2. **Never use mocks** for things you can run for real. Prefer real services (testcontainers, in-memory adapters, local servers) over `vi.mock`/`jest.mock`.
3. **Pin exact versions** in dependency overrides. No drift.
4. **Never re-export external deps** for convenience — consumers import from the upstream source.
5. **Never auto-commit/push** without user approval. Never use `--no-verify`.
6. **Always use absolute paths** in tool calls.
7. **Read files before editing them** — understand context first.
8. **Testing-infrastructure packages must not depend on the project's runtime packages.** Only external deps (and a zero-runtime types package, if you have one).
9. **Never write static-analysis suppression comments** (`// biome-ignore`, `// eslint-disable*`, `// ts-ignore`, `// ts-expect-error`) in new or migrated code. Stale rule names break the lint gate; comments that no longer apply produce "has no effect" warnings. To exercise a deliberate violation, use a pattern the linter cannot statically reject (see §10b).
10. **Never write `export *` in any non-root barrel.** Feature-module barrels MUST use explicit named re-exports. Exempt: generated forwarder files, single-line variant forwarders, and namespace re-exports (`export * as ns from "..."`). Migrate `export *` → named exports inside the same commit, never as a follow-up.
11. **Never import test-runner primitives directly from `vitest` or `bun:test`.** Route all test imports through `@suaveplan/testing/runner` (a conditional-export wrapper resolving to `vitest` by default, `bun:test` under the `bun` condition), so tests execute identically under either runner. Root-level `scripts/` tooling tests are exempt (they're outside the package workspace); package test files are not.

---

## 4. Git safety (non-negotiable)

Before ANY git operation: run `git status` in **every** worktree (`git worktree list`) and confirm each is clean or its state is understood.

**Never run these without explicit per-use user approval:**

- `git filter-repo` / `git filter-branch` — rewrites history, destroys staged + working tree.
- `git push --force` / `--force-with-lease` — only after the user explicitly says "force push".
- `git reset --hard`, `git clean -fd`, `git rebase`, `git stash drop`/`clear`, `git gc`/`prune`, `git checkout -- <file>`.

**Large-file push errors:** stop. Do NOT rewrite history. Run `git status` / `git stash list` in all worktrees, then ask the user (`.gitignore` + new commit, Git LFS, or manual removal).

Staged changes are irreplaceable — treat them as more precious than committed history.

### 4.1 Worktree discipline — long-lived worktrees are never the answer

- Before opening a worktree or dispatching a parallel agent: `git worktree list` and `git status` in each existing one. Account for every entry: active agent, work-pending-merge, or stale-and-prune.
- After a worktree-based agent ships (commit on a `feat/*` branch), remove the worktree (`git worktree remove`) so the count returns to baseline. The branch + commit survive; the directory does not need to.
- The baseline is **one worktree** (the main checkout). Anything beyond that is an open ticket waiting to be closed.
- If your project has one, run its worktree-prune script to audit + prune in one command. It should be idempotent and refuse to remove worktrees whose HEAD commit isn't reachable from any branch ref (so it never loses work).

### 4.2 Worktree-isolated agents: never edit the main checkout

When an agent is dispatched into an isolated worktree (e.g. `.claude/worktrees/agent-<id>/`), every file operation MUST target that worktree path, never the main checkout. The hazards are real and observed:

1. First action in every agent session: `pwd && git worktree list` to confirm you're in the right tree. If `pwd` shows the main checkout path instead of a worktree path, STOP and report — you are not in an isolated worktree.
2. Use **relative paths** (`packages/...`, `src/...`) for every read/edit/write. Avoid absolute paths in tool calls unless reading reference material from outside the worktree.
3. Never `cd` to the main checkout from a worktree. Read/Edit/Write tools resolve relative paths against the working directory of the shell session, which starts in the worktree.
4. Before committing: `git rev-parse HEAD` and `git rev-parse --show-toplevel` must show your worktree's branch + path, not main's. If either is wrong, your work landed in the wrong place — recover with `git status` in BOTH locations, then move the changes back via patch (`git diff > /tmp/work.patch`, `cd $WORKTREE`, `git apply /tmp/work.patch`).

Cross-worktree leakage is a common failure mode in agent-dispatched work — it can waste an hour or more per occurrence. Treat this rule as the prevention, not a suggestion.

### 4.3 Sync — worktrees can fork from a stale base

Some harnesses' `isolation: "worktree"` feature may fork from an earlier session-stable ref rather than the current main-branch HEAD. This can silently bite a wave of parallel agents (all forked from a commit that predates the wave). Prevention: every parallel-dispatch prompt MUST include a sync block that fast-forwards the worktree to a known base SHA before any work begins:

```bash
EXPECTED_BASE=<orchestrator-supplied-sha>
if ! git merge-base --is-ancestor "$EXPECTED_BASE" HEAD; then
    git fetch <main-checkout-path> <main-branch>
    git merge FETCH_HEAD --no-edit
fi
git merge-base --is-ancestor "$EXPECTED_BASE" HEAD || { echo "STILL OUT OF DATE"; exit 1; }
```

The orchestrator passes the expected SHA at dispatch time. Agents that can't reach it STOP and report rather than proceeding wave-blind. Without this gate, agents re-invent interfaces from earlier merges and produce work that doesn't integrate.

---

## 5. Workflow rules

1. **Create a task list for multi-step work** (>3 steps).
2. **Complete all implementations.** No stubs, no placeholders, no TODOs, no mocks in production. Missing dep? Add it and wire the real implementation.
3. **Build feature-rich, production-grade packages.** Prefer comprehensive over MVP. Every package ships at full functional completeness on first landing — never defer a feature its name reasonably implies to a follow-up proposal.
4. **Professional honesty.** No marketing language. No fake metrics.
5. **Preserve the full public surface** during rewrites. Trim only when duplicated in-repo or replaceable by an existing in-repo library.

---

## 6. Package layout

### 6.1 Directory structure

Domain-first organization, with **per-feature folders** containing five co-located files:

```text
src/<category>/
  <feature>/
    index.ts                # Barrel — explicit named re-exports
    <feature>.ts            # Implementation
    <feature>.test.ts       # Unit tests
    <feature>.types.ts      # Type definitions (optional)
    <feature>.md            # Co-located documentation (mandatory for impl files)
```

Special directories:

- `types/` — shared types, flat
- `utils/` — flat with tests + docs
- `constants/index.ts` — simple exports (no tests/docs needed)

### 6.2 Naming rules

- **No package-name prefix inside package folders.** Inside `packages/<category>/<pkg>/`, child folders/files use the feature name only — never `<pkg>-<feature>`. The package name is already in the path.
- **No redundant ancestor names.** A child name must not contain the singular or plural form of any ancestor folder. If parent is `adapters/`, children must not be `memory-adapter/`; use `memory/`. Apply to: `strategies`, `providers`, `builders`, `plugins`, `handlers`, `resolvers`, `factories`, `parsers`, `services`, etc.
- **One `README.md` per package root only.** No category-level READMEs inside `src/<category>/`.

### 6.3 Subpath exports

Every feature directory must have its own entry in `package.json` `exports` so consumers can tree-shake:

```json
"./retry/retry": {
  "import": { "types": "./dist/retry/retry.d.ts", "default": "./dist/retry/retry.js" }
}
```

A single `"."` barrel is insufficient. The count of subpath exports should match the count of feature modules.

### 6.4 Barrel rules (explicit named exports only)

```ts
// CORRECT — feature barrel: explicit named exports
export {
  decryptStream,
  type DecryptStreamOptions,
  encryptStream,
  type EncryptStreamOptions,
} from "./streaming.js";

// WRONG — leaks every new export silently
export * from "./streaming.js";

// CORRECT — top-level namespace re-export (recommended for primitives with shared names)
export * as ed25519 from "./primitives/ed25519/ed25519.js";
```

Why: the barrel **is** the contract; `export *` makes the contract whatever the source happens to declare today. Tree-shaking is equivalent under `"sideEffects": false`.

### 6.5 Shared tooling foundations — every new package builds on these

This template is part of the SuavePlan ecosystem, so new packages don't hand-roll their own lint/tsconfig/build/test setup. For lint, TypeScript, and Vite config specifically, packages extend this repo's own `@repo/*` wrapper packages (`packages/tooling/{biome-config,typescript-config,vite-config}/`) rather than the published `@suaveplan/*-config` packages directly:

- **`biome.json`** — `{ "extends": ["@suaveplan/biome-config/biome.json", "@repo/biome-config/biome.json"], "root": false }`. **Both entries are required, in that order** — Biome's `extends` is not transitive (a config resolved via `extends` does not, in turn, process that target's own `extends`), so `@repo/biome-config` cannot wrap `@suaveplan/biome-config` internally the way the other two configs do. It's instead a small, standalone overrides fragment listed as the second parallel array entry, verified to merge correctly with later entries winning on conflicts. See `packages/tooling/biome-config/README.md` for the full explanation.
- **`tsconfig.lib.json`** — `{ "extends": "@repo/typescript-config/library.json", "compilerOptions": { "rootDir": "src", "outDir": "dist" }, ... }`. Use `library-browser.json` for browser-tier packages, `library-node.json` for server-tier, `react-library.json` for React components. TypeScript's `extends` **is** transitive (verified), so this one genuinely wraps `@suaveplan/typescript-config` — one entry is enough.
- **`vite.config.ts`** — `import { defineLibConfig } from "@repo/vite-config";`, which derives rollup externals from the package's own manifest so published `dist/` never bakes in store paths.

Each `@repo/*-config` package is a thin, `"private": true` workspace-only wrapper around the matching `@suaveplan/*-config` package — see `packages/tooling/_intro.md`. This is a deliberate exception to rule 4 ("never re-export external deps for convenience"): that rule targets re-exporting runtime values to shorten an import path, which adds no value and rots silently. Extending a shared build/lint config is the opposite case — the `@repo/*` layer is this repo's single edit point for a repo-wide config tweak (an extra Biome rule, a compiler option, a Vite plugin), exactly analogous to how the root's own `tsconfig.base.json` already extends `@suaveplan/typescript-config/base.json`. Don't add a `@repo/*` wrapper for a dependency you're merely passing through unchanged with no such centralization purpose.

Everything else still comes straight from the published `@suaveplan/*` packages, no local wrapper:

- **`vitest.config.ts`** — `export default createTestConfig()` from `@suaveplan/testing/config` (see §15).
- **Test files** — import runner primitives from `@suaveplan/testing/runner`, never directly from `vitest`/`bun:test` (see rule 11 and §7 of `openspec/AGENTS.md`).
- **Errors** — extend `SuaveplanError` from `@suaveplan/error` and register codes via its `defineCodes(...)` helper (see §13) rather than hand-writing string literals or plain `Error` subclasses.
- **Cross-package contracts and shared primitives** — `Clock`, `IdGenerator`, `Rng`, `LoggerLike`, `StorageLike`, and other structural interfaces referenced by ≥2 packages live in `@suaveplan/types` (zero-dep, types-only — see §12.3), not redeclared per package.
- **Playwright E2E specs** (`e2e/*/`) — build on `@suaveplan/testing-e2e`'s config factory, `PageObject` base, and fixtures rather than a hand-rolled `playwright.config.ts`.

The repo root's own `biome.json` (`root: true`), `tsconfig.base.json`, and `tsconfig.json` are intentionally left extending/authoring against `@suaveplan/*` directly, not `@repo/*` — the `@repo/*` layer exists for individual packages' and apps' own configs, not as a replacement for the root's already-authoritative config.

All of `@suaveplan/error`, `@suaveplan/types`, `@suaveplan/testing`, `@suaveplan/testing-e2e`, and the three `@suaveplan/*-config` packages are already root `devDependencies` (§7), installed and ready before the first package is scaffolded. The three `@repo/*-config` wrappers are workspace packages (`workspace:^`), not root deps — add them as `devDependencies` on each new package the same way.

---

## 7. Dependency conventions

- **External deps** use catalog refs (or workspace-level pinning) — never bare versions like `"^1.2.3"`.
- **Internal deps** use `workspace:^`.
- `"sideEffects": false` on all pure library packages.
- After changing `overrides`, nuke and reinstall:

  ```bash
  rm -rf node_modules <lockfile> && find . -type d -name "node_modules" -exec rm -rf {} + && <install>
  ```

- For browser/React packages: verify only one React version exists after install:

  ```bash
  find . -path "*/node_modules/react/package.json" | head -5
  ```

---

## 8. Banned patterns in `src/`

Before closing any task, scan for zero matches:

```bash
grep -rn "@deprecated\|TODO\|FIXME\|ts-ignore\|ts-expect-error\|\.skip\|\.only\|\bany\b\|console\.log" \
  packages/<category>/<pkg>/src/ --include="*.ts"
```

- `@deprecated` JSDoc → replace with prose: "Backwards-compatibility alias for X."
- `any` → use `unknown` (narrow via `instanceof` / type guards) or a proper generic. Never substitute `object`, `{}`, or a redundant union.
- `console.log` → use a real logger (injectable `LoggerLike` interface preferred).

### 8.1 No stubs, placeholders, or "WIP" code

Concretely banned in any commit:

- **Stub functions** — `throw new Error("not implemented")`, identity pass-throughs that pretend to do work, no-op factories.
- **Placeholder types** — `type Foo = unknown`, empty `interface Foo {}`, `as never` hiding incomplete data flow.
- **TODO / FIXME / XXX comments** in source AND docs.
- **Deprecation aliases without a working replacement.**
- **"Phase 1 / Phase 2" splits** where Phase 2 is unwritten and Phase 1 ships a function that doesn't do the thing its name claims.
- **Marketing language masking incomplete work** ("comprehensive", "fully-featured" applied to code with unimplemented branches).
- **Tautological tests** — `it.todo`, `it.skip`, `expect(true).toBe(true)`, `expect(result).toBeDefined()` standing alone, tests that assert against the exact hardcoded value the implementation returns. Every `it(...)` MUST verify a behavior the implementation could plausibly get wrong.
- **Stub docs** — `.md` files that say "TODO", empty Features/API sections, or fail word-count gates.
- **Empty test files** kept only to keep coverage thresholds passing.
- **Silently dropped spec requirements** — see §2c of the OpenSpec doc. If a requirement is in the spec delta, it ships.

If the work isn't ready: don't merge it. The default branch is the product, not a scratchpad.

### 8.2 Never delete spec elements to satisfy a gate

When a gate fails because a registered element (error code, schema field, event topic) is **declared but unused**, the failure is telling you the implementation hasn't caught up to the proposal. **Wire it in**, do NOT delete it. Deletion is the path of least resistance and silently strips features the proposal committed to.

If the element genuinely crept in by mistake, remove it with a one-line note under `### Deferred` or `### Removed` in `proposal.md` so the deletion is auditable.

### 8.3 Never delete code that serves a purpose to make tests pass

When a coverage report flags a function, branch, or guard as uncovered, write a test that exercises real behavior — do NOT delete the code that's hard to reach.

Concretely banned:

- Deleting defensive guards because current call sites don't trigger them.
- Deleting rollback/cleanup helpers because the synchronous code path can't reach them.
- Replacing `instanceof Error ? cause : undefined` with `cause as Error` to "simplify."
- Deleting branches inside `try/catch` because the library doesn't currently throw.

Instead, in priority order:

1. **Write a test that exercises the path** — inject a controlled failure (custom storage that throws, custom Clock that returns a chosen instant, AbortSignal scheduled via `queueMicrotask`).
2. **Restructure to make the path reachable** without changing semantics (e.g. `await Promise.resolve()` between iterations so a caller-side abort can land).
3. **If genuinely unreachable**, annotate with `/* c8 ignore next */` and a comment naming the unreachability proof.

### 8.4 Suppression workaround pattern

When a deliberate violation is required (e.g. testing a defensive non-Error branch), use a pattern the linter can't statically reject:

```ts
// BANNED — suppression rots when rule renames.
// biome-ignore lint/suspicious/noThrowLiterals: ...
throw "literal";

// REQUIRED — linter can't prove the value isn't Error-like.
const failure: unknown = "literal";
throw failure;
```

---

## 9. File-size budgets

- **Source files**: 300 lines hard / 250 soft.
- **Test files**: 500 lines max.
- **Functions**: 50 lines soft — extract helpers at natural responsibility boundaries.

```bash
find packages/<category>/<pkg>/src -name "*.ts" ! -name "*.test.ts" | \
  xargs awk 'END { if (NR > 300) print FILENAME, NR " lines" }'
```

Split at natural boundaries. Preserve all public exports.

---

## 10. Quality gates

### 10.1 Coverage

**100 / 100 / 100 / 100** for every package, no exceptions:

```ts
thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 }
```

The pre-publish gate MUST hard-fail below 100%. Mutation / property / fuzz testing layer on top — they do not substitute.

### 10.2 Tests

- Use **Arrange-Act-Assert**.
- Name tests after the **behavior**, not the implementation:

  ```ts
  // CORRECT
  it('returns empty array when no results match', ...)
  it('throws ValidationError when required field is missing', ...)

  // WRONG
  it('test1', ...)
  it('works correctly', ...)
  it('handleSearch', ...)
  ```

- File suffixes: `.test.ts` for unit, `.spec.ts` for E2E.
- Always pass a timeout: `it(name, { timeout: 5000 }, fn)` (30000 for async-heavy).
- Root-cause every failure — never `.skip` or `.only` to ship.
- Every UI component needs `.stories.tsx` (default + playground + variants).

### 10.3 Pre-publish gate

```bash
bunx turbo lint typecheck test --filter=<pkg>
bunx turbo test:coverage --filter=<pkg>
bunx turbo build --filter=<pkg>
```

All must be green. Single-file test runs are not a substitute for the full-package gate.

---

## 11. Documentation

### 11.1 Sibling `.md` per implementation file

Every `.ts`/`.tsx` MUST have a sibling `.md`. **Exclusions**: `.test.ts`, `.test.tsx`, `.spec.ts`, `.types.ts` (inside a feature dir), `.stories.tsx`, barrel `index.ts`, `constants/index.ts`.

**Required sections** (≥200 words excl. code):

1. **Purpose** (≥2 sentences — what and why)
2. **Features** (bullet list)
3. **Usage: Basic Example**
4. **Usage: Advanced Example**
5. **API Reference** (every exported symbol — params, return type, throws)
6. **Implementation Notes** (design decisions, limits, edge cases)

Hard constraints: both simple AND advanced examples mandatory; code must compile with real imports; no marketing/placeholder text; update docs when code changes.

### 11.2 Three-pass writing workflow

Never one-shot:

1. **Read** — full `.ts` file; note every exported symbol, param, thrown error.
2. **Structure** — Purpose + Features + API Reference first.
3. **Examples** — Basic (simplest happy path), then Advanced (real composition / edge case).

### 11.3 Doc-drift gate

When you modify any `<feature>.ts`, you MUST update its sibling `<feature>.md` in the same change if the modification affects:

- public API surface (added/removed/renamed export, changed types, changed throws)
- documented behavior (error codes, side effects, semantics)
- examples in the `.md` (must still compile)

Editing `.ts` without touching `.md` is treated as a defect, identical in severity to a failing test.

```bash
# For every changed .ts, confirm the sibling .md is also touched
git diff --name-only HEAD | awk '
  /\.ts$/ && !/\.test\.ts$/ && !/\.spec\.ts$/ && !/\.types\.ts$/ && !/\/index\.ts$/ {
    md = $0; sub(/\.ts$/, ".md", md)
    cmd = "git diff --name-only HEAD -- " md
    cmd | getline touched; close(cmd)
    if (touched == "") print "DOC DRIFT: " md " not updated alongside " $0
  }
'
```

### 11.4 Root `README.md`

Every package needs `README.md` at the root with:

1. Package name (H1)
2. One-paragraph description
3. Install command
4. Quick-start code example
5. **Modules** — links to every co-located `.md` in `src/` via relative paths

---

## 12. Type design

### 12.1 No nested object literals in interfaces

Every nested object shape must be a named `interface` or `type`.

```ts
// WRONG
interface CreateUserOptions {
  profile: { displayName: string; avatarUrl: string }
  notifications: { email: boolean; push: boolean }
}

// CORRECT
interface UserProfile { displayName: string; avatarUrl: string }
interface NotificationPreferences { email: boolean; push: boolean }
interface CreateUserOptions { profile: UserProfile; notifications: NotificationPreferences }
```

### 12.2 No inline shapes in function signatures

```ts
// WRONG
function createSession(user: { id: string }, opts: { ttl: number }): { token: string } { ... }

// CORRECT
function createSession(user: SessionUser, opts: SessionOptions): SessionResult { ... }
```

### 12.3 Shared types belong in a zero-dep types package

If a type is referenced by ≥2 packages, define it in a shared `types`/`contracts` package with zero runtime code and zero workspace deps. This prevents circular dependencies and makes the public contract single-sourced.

---

## 13. Error handling

Use a centralized error system (`defineCodes("<NAMESPACE>", ["REASON_A", "REASON_B"] as const)` style) rather than hand-written string literals. Rules:

- **In code**: throw `new XxxError(CODES.REASON, …)` using the exported constant. Never type the raw `"NAMESPACE.REASON"` string by hand.
- **In tests**: assert against the constant (`expect(err.code).toBe(CODES.REASON)`), never against a hand-typed literal — those rot silently.
- **In specs**: when a spec references a code, use the exact namespaced form. Spec values must match the code-generated value verbatim.
- **On mismatch**: fix the spec to match the convention-correct value — do not bend the code's namespace to match a mistaken literal.

Every registered error code MUST be reachable from a real call site exercised by a test. A registered-but-never-used code is a defect.

---

## 14. Web app / page verification

When generating client-side pages, verification is NOT optional and a 200 response is NOT proof of correctness:

1. **Staging environment** — mirror production before declaring done (Docker / preview deploy).
2. **Full Playwright E2E sweep** — every page, every component, every navigation.
3. **Never trust HTTP 200 alone** — verify rendered DOM contains expected content.
4. **Inspect browser console** — any unexpected error or warning fails the check.
5. **Inspect network activity** — failed requests, missing assets, CORS, mixed content.
6. **Zero-defect to live** — fix root cause first.

---

## 15. Vitest / WSL2 specifics

- Use `createTestConfig()` from `@suaveplan/testing/config` — `export default createTestConfig()` is the entire `vitest.config.ts` for the common case. It bakes in the `forks` pool, the `@suaveplan/testing/polyfills` setup file, and istanbul coverage at 100/100/100/100 thresholds. For configs needing aliases/plugins, write standalone with `pool: 'forks'` + the polyfills setup file rather than dropping `createTestConfig()` entirely.
- **Never `mergeConfig` with a base config** that may omit polyfills — causes `crypto is not defined` and similar at runtime.
- **`vmThreads` and `threads` pools fail in Bun on WSL2** — use default `forks`.
- **`fileParallelism: false`** required for browser tests (pass `environment: "happy-dom"` and `fileParallelism: false` to `createTestConfig()`).

---

## 16. Code-tier organization

Encode the runtime tier in `package.json` (`"browser"` field, peer deps, `engines`), not in the folder path.

- **Universal**: ZERO browser/React/Node-only deps.
- **Browser**: React/DOM ok.
- **Server**: Node.js ok.

Co-locate tests with source; sibling `.md` docs per implementation file.

---

## 17. Package lifecycle

- **New packages**: add to manifest, regenerate dep graph index.
- **Editing**: every package starts at `0.1.0`; bump only at `1.0.0` graduation.
- **Pre-publish gate (non-negotiable)**: lint + typecheck + test + 100% coverage on touched modules + build all green.
- **Foundation packages**: when changing a widely-consumed package, run the **dependent sweep** (`bunx turbo test --filter=...<pkg>`) before declaring done. Green local tests do not prove you didn't break consumers.

---

## 18. Quick reference commands

```bash
# Test one package
bunx turbo test --filter=<pkg>

# Coverage for one package
bunx turbo test:coverage --filter=<pkg>

# Lint + typecheck + tests
bunx turbo lint typecheck test --filter=<pkg>

# Pre-publish gate
bunx turbo lint typecheck test build --filter=<pkg> && bunx turbo test:coverage --filter=<pkg>

# Dependent sweep (foundation packages)
bunx turbo test --filter=...<pkg>

# Changed since main
bunx turbo test --filter=...[main]
```

---

## 19. Behavior-change propagation

When a change introduces consumer-visible behavior changes (new error code, renamed metric, method that now throws, default that flipped, return shape change), do all three:

1. **Self-doc**: update sibling `.md` + `README.md` Features section.
2. **Dependent surface scan**: `grep -rln "<old-name>" packages/ | grep -v "/dist/\|/<own-pkg>/"`. Every hit needs updating in the same change set.
3. **Migration note**: add `## Migration` to `proposal.md` listing old behavior, new behavior, search command for consumers, recommended replacement.
