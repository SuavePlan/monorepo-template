# OpenSpec — Agent Compliance Checklist

Read this file before implementing any OpenSpec change on {{PROJECT_NAME}}. Every section is a non-negotiable gate. Paired with **CLAUDE.md** for general engineering standards.

---

## 0. Research before implementing

Before writing a new package or migrating a library — mandatory, not optional:

1. **Search the registry** (npm / PyPI / crates.io / etc.) for existing implementations. Prefer battle-tested over hand-rolled. Check the root manifest's `catalog` / `dependencies` block for deps already pinned.
2. **Check vendor docs** (via Context7 or similar) to confirm API behavior and version-specific details before wrapping an external library.
3. **Search your own repo** for reference implementations and patterns. Try local copies of upstream sources first.
4. If an existing implementation covers 80%+ of the requirement, **port or wrap it** — do not start from scratch.
5. If a starting-from-scratch is unavoidable but a prior implementation exists, **read its nested `.md` files first** to understand its purpose.
6. **Check the dep graph** — if a new type or abstraction is shared across ≥2 packages, it belongs in a zero-dep shared types package. Add it there first, then reference it. Prevents circular dependencies and keeps the public contract in one place.

---

## 0a. Migration parity — no cut-down replacements

When migrating a library from an upstream source, **a greenfield rewrite is a last resort, not a default.** The upstream library exists because it solved real problems. Dropping features because they are "complex" or "not needed yet" is how you end up with broken consumers later.

### Mandatory parity checklist

Every migration proposal MUST include a `## Parity Checklist` section. Before any code, read the upstream source, any upstream specs, and any upstream audit docs. Then produce a table:

```markdown
| Capability | Upstream | Migrated | Notes |
|---|---|---|---|
| Feature A | ✅ | ✅ | |
| Feature B | ✅ | 🚫 | Scoped out: reason … |
| Feature C | ✅ | ⬆️ | Enhanced: added … |
```

Rules:

- **No implicit drops.** If upstream has it and the migration does not, the box is 🚫 and MUST have a justification.
- **"Not needed yet" is banned as a justification.** Scope out only with a concrete architectural reason (e.g. "replaced by interceptor API which covers the same use case via composition").
- **If the justification is longer than one sentence, the feature is not scoped out — it is required.**
- **The checklist is a gate.** A proposal with unchecked 🚫 items without justification is rejected.

### Design quality bar

Migrations must be **modular and extensible**:

- Use TypeScript generics for type parameters — not `any` or `unknown` escape hatches.
- Prefer composition over inheritance. Public surfaces are interfaces callers can implement.
- Avoid closed unions where module augmentation or registry patterns are possible.
- Preserve upstream subpath exports — every public module must be tree-shakeable.
- Merge upstream and downstream improvements. The migrated package gains every enhancement from both sides.

### Anti-patterns that block approval

| Anti-pattern | Why it fails |
|---|---|
| "Fresh build" with a different API | Consumers expecting upstream contracts break silently. |
| `export *` in any non-root barrel | Banned — the barrel IS the contract; convert to explicit named exports inside the migration commit, not a follow-up. |
| Direct runner imports in non-exempt test files | Tests must route through the runner-neutral wrapper; rewrite during the migration commit. |
| Dropping schema-driven features for "simplicity" | Callers abandon the package and hand-roll the missing logic. |
| Replacing upstream errors with plain `Error` | Loses programmatic handling, telemetry, and i18n keys. |
| Ignoring upstream enterprise audit | The audit flagged real gaps; ignoring them recreates them. |

### Reference docs you must read

Before migrating any package:

1. The canonical upstream capability spec.
2. Any upstream change proposals (active and archived) that modified the package.
3. Any upstream enterprise audit with coverage / error / quality gaps.
4. Any design docs referenced by those proposals.

If any are missing, note it in the parity checklist and explain the risk.

---

## 0b. Ecosystem awareness — read your status dashboard

Before writing a new package or migrating a library, **read the root status file** (e.g. `STATUS.md`) to learn which packages already exist, which are completed, and which are pending.

Rules:

- **If your package depends on something in `Pending`**, that dependency **must be migrated first** (or a compatible substitute must already exist). Do not hand-roll a replacement without explicit justification in the parity checklist.
- **If the package itself is in `Pending`**, it **must have an OpenSpec change written first** (`proposal.md` + `tasks.md`) before any code.
- **If the package does not exist anywhere**, it is an original. It **still** must have an OpenSpec change written first.
- Never start coding without either (a) completed migration of all pending dependencies, or (b) an approved proposal that explicitly scopes out missing dependencies with architectural justification.

Checking the status file prevents duplicate work, broken downstream consumers, and incompatible re-implementations.

---

## 0c. Authoring the change — folder structure and spec-delta format

**Read this before you create a single file in `openspec/changes/`.** Every rule here is a gate.

### The change folder has exactly this shape

```text
openspec/changes/<change-id>/
  proposal.md                       # what & why, impact, affected dependents
  tasks.md                          # ordered implementation checklist
  design.md                         # OPTIONAL — non-normative design: rationale, algorithms,
                                    # code sketches, file layout, diagrams, trade-offs
  specs/<capability>/spec.md        # the SPEC DELTA — normative requirements only
```

- `<capability>` is the **package short name** without any scope prefix. One capability folder per package. Mirrors the eventual canonical path `openspec/specs/<capability>/spec.md`.
- `design.md` is optional but **strongly preferred** for any non-trivial package. It is the home for everything that is *not* a testable requirement: architecture, algorithm notes, file layout, integration narrative, benchmark plans, decisions & trade-offs. If you're writing prose that isn't a `### Requirement:`, it belongs in `design.md`, not the spec delta.

### `openspec/specs/` is OFF LIMITS until archival

`openspec/specs/<capability>/spec.md` is the **canonical, shipped** spec. It is written to **only** by the §14 archival fold step, **after** all gates pass. While a change is `PROPOSED` or in progress:

- **NEVER create or edit anything under `openspec/specs/`.** Not a stub, not a placeholder, not a "draft for reference". If `openspec/specs/<your-capability>/` exists before your change archives, delete it and move the content into your change's `specs/<capability>/spec.md` delta.
- The file inside your **change** folder is a **delta**, not the canonical spec. It is folded into `openspec/specs/` on archive and the change folder is moved to `openspec/archive/`.

### The spec delta is a normative requirements document — not an architecture dump

The delta MUST use the OpenSpec requirement/scenario format. Skeleton:

```markdown
<!-- markdownlint-disable MD024 -->

# Capability Spec Delta: <capability>

**Package**: `<pkg>`
**Status**: PROPOSED

> Every requirement below carries a `**Verified by:**` line at authoring time. No exceptions.

## ADDED Requirements

### Requirement: <Imperative name>

The package SHALL … / MUST … — normative, testable prose. One requirement = one capability.

#### Scenario: <observable behaviour>

- **WHEN** <precondition / action>
- **THEN** <observable, checkable outcome>

**Verified by:** `src/<feature>/<feature>.test.ts::"<planned test name>"` AND `<another planned test>`

---

### Requirement: <next one>
…
```

Rules for the delta:

- Top-level headings are exactly `## ADDED Requirements`, `## MODIFIED Requirements`, and/or `## REMOVED Requirements` — nothing else. A fresh package uses only `## ADDED Requirements`.
- Every `### Requirement:` has **normative prose** (SHALL / MUST / SHALL NOT), **one or more** `#### Scenario:` blocks as `- **WHEN**` / `- **THEN**` bullets, and **exactly one** `**Verified by:**` line. Separate requirements with `---`.
- `**Verified by:**` is authored **at draft time**. The change is not implemented yet, so it names **planned** test files (paths from `tasks.md` / `design.md` file layout) in `path::"test name"` form. That is expected and correct — it is the contract the implementation must satisfy.
- Cover the **whole contract**: public API surface, every error code (each must be reachable from a real call site), boundary validation, telemetry instrumentation, `AbortSignal` propagation, subpath exports, tier purity (universal → no browser/Node APIs; browser → no Node; server → no browser). Match the package's depth — a large package is 15–25 requirements, a small leaf is 8–12.

### `proposal.md` and `tasks.md` obligations

- `proposal.md` MUST link its design and delta in the header block (`- **Design**: ./design.md`, `- **Spec delta**: ./specs/<capability>/spec.md`) — **never** a `Reference spec:` pointer into `openspec/specs/`. It MUST carry the `## Impact` → `### Affected dependents` section per §14a.
- `tasks.md` MUST end with a "Fold `specs/<capability>/spec.md` into `openspec/specs/<capability>/spec.md`" step immediately before the archive step (see §14).

### Multi-package / cross-cutting feature sets

When one feature spans many packages (a family, a wave of transports, etc.):

- **One change per package.** Each package gets its own `openspec/changes/<id>/` with its own `specs/<capability>/spec.md` delta. Do **not** write a single umbrella spec covering the whole family, and do **not** put a shared `specs/<family>/` folder anywhere.
- **Shared architecture lives once, in the foundation package's `design.md`.** Sibling `design.md` files **reference** it by relative path rather than duplicating.
- Each change still stands alone: its `proposal.md`, `design.md`, `tasks.md`, and delta are self-sufficient.

### Pre-flight checklist — before you write any change file

1. The package is in the project status dashboard, or is an original — confirmed per §0b.
2. You have read the upstream references in §0a (for migrations) or the design inputs (for originals).
3. You will create `proposal.md` + `tasks.md` + `specs/<capability>/spec.md` (+ `design.md`), and **nothing** under `openspec/specs/`.
4. The delta will be in `## ADDED/MODIFIED/REMOVED Requirements` form with `### Requirement:` / `#### Scenario:` / `**Verified by:**` — not an API dump.
5. `proposal.md` will carry `### Affected dependents` (§14a); `tasks.md` will carry the fold step (§14).
6. **You have created a numbered checklist of every `### Requirement` and every `#### Scenario` in the spec delta.** This lives in your working notes. You may not begin implementation until every requirement is listed as a discrete, checkable item. As you implement, check each off. An unchecked item at the end means the package is not done. **Never silently skip a requirement because "tests already pass without it."** That is the single most common cause of spec drift.

---

## 1. Dependency conventions

- All external deps use catalog refs — **never bare version strings** like `"^1.2.3"`.
- All internal deps use `workspace:^`.
- If a catalog key does not exist, add it to the root manifest first.
- Coverage provider must be installed as a `devDependency` via catalog ref. Without `@vitest/coverage-istanbul` (or equivalent), Istanbul-style coverage silently falls back to v8.
- Testing-infra packages have **zero** internal workspace deps.

---

## 2. No banned patterns in `src/`

Before closing any task, scan for zero matches:

```bash
grep -rn "@deprecated\|TODO\|FIXME\|ts-ignore\|ts-expect-error\|\.skip\|\.only\|\bany\b\|console\.log" \
  packages/<category>/<pkg>/src/ --include="*.ts"
```

- `@deprecated` → prose: "Backwards-compatibility alias for X."
- `any` → `unknown` + narrowing, or a proper generic.
- `console.log` → real logger / injectable `LoggerLike`.

## 2a. Lint suppressions

Stale `// biome-ignore` / `// eslint-disable*` comments break the lint gate hard.

Rules:

1. **Never write a suppression comment for transient lint noise.** If the linter flags something, it's a real signal — fix the code.
2. **If a deliberate violation is required**, use a coding pattern the linter cannot statically reject (see §8.4 of CLAUDE.md).
3. **If a suppression genuinely is the only path**, pin both the current rule category and a one-sentence reason. Verify the category resolves before committing.
4. **Scan before closing any task:** `grep -rn "biome-ignore\|eslint-disable" packages/<category>/<pkg>/src/ --include="*.ts"`. Every hit MUST be justified in code review.

## 2b. NEVER ship stubs, placeholders, or "WIP" code

See **CLAUDE.md §8.1** for the full list. Banned: stub functions, placeholder types, TODO/FIXME, "Phase 2 unwritten" splits, marketing language masking incomplete work, tautological tests, stub docs, empty test files, silently dropped spec requirements.

If you discover an existing stub during audit (40-line README that fails `docs:check`, a function with `return undefined as never`, a barrel re-exporting nothing), the right answer is to **fix it inside the same change** as your other work. Leaving it is a vote for the placeholder.

## 2c. NEVER delete spec elements to satisfy a gate — wire them in

When a gate fails because a registered element (error code, schema, event topic, requirement, capability constant) is **declared but unused**, the failure is telling you the implementation hasn't caught up to the proposal. The fix is to **wire the element into the call site the proposal designed it for**, NOT to delete the element from the registry.

Deletion is the path of least resistance and silently strips features the proposal committed to. The proposal is the contract; the registry is the proposal expressed in code. Removing an entry to make a tool happy is the same defect as marking a failing test `.skip` to make CI green.

Concretely banned:

- **Removing an error code** from the codes registry because conformance check flags it as unused. Find the call site that should be raising / reporting it and wire it in.
- **Deleting a schema field** because no caller populates it yet.
- **Removing an event topic** because no emitter exists. Add the emitter; the topic is an API surface the proposal owns.
- **Quietly removing a `## ADDED Requirements` line** because the implementation doesn't cover it. Either implement it or open a follow-up change that explicitly defers it with reasoning — never silently retract.
- **Lowering coverage / docs-check thresholds** to make a gate pass.

When in doubt, ask: *"Was this element part of the proposal I'm implementing?"* If yes, **wire it in**. If genuinely no (it crept in by mistake), removing it requires a one-line note in `proposal.md` under `### Deferred` or `### Removed` so the deletion is auditable.

---

## 3. File-size budget, documentation, README

See **CLAUDE.md §§9, 11**. Summary:

- Source files 300 lines hard / 250 soft; test files 500 max; functions 50 soft.
- Every `.ts` impl file needs a sibling `.md` with Purpose / Features / Basic / Advanced / API / Implementation Notes (≥200 words excl. code).
- Doc-drift gate: changing a `.ts` requires touching the sibling `.md` in the same change set when the public surface or documented behavior changes.
- Root `README.md` per package: name, description, install, quick-start, Modules link list.

### 3a. Feature-folder layout — one folder per code file (NON-NEGOTIABLE)

This rule is easy to let slip — "the rest of the package was already flat" is not a defense. When you touch a package, bring the modules you add (and the category folders you work in) into compliance.

**Every implementation module lives in its own directory.** A feature module is a directory `src/<…>/<feature>/` that contains *only that feature's* files:

```text
src/<category>/<feature>/
  <feature>.ts            # the implementation (exactly one impl file per folder)
  <feature>.test.ts       # co-located unit tests
  <feature>.md            # co-located docs (§3)
  <feature>.types.ts      # (optional) feature-local types
  index.ts                # (optional) explicit-named barrel (§5)
```

**Banned: the "junk-drawer" category folder** — two or more implementation files sitting flat as siblings in one directory:

```text
# WRONG — flat siblings in a shared category folder
src/file-operations/copy.ts
src/file-operations/move.ts
src/file-operations/scan.ts

# CORRECT — one folder per code file
src/file-operations/copy/copy.ts
src/file-operations/move/move.ts
src/file-operations/scan/scan.ts
```

Co-locating exactly one implementation with its test/doc/types is what makes subpath exports (§4) line up 1:1 with directories and keeps a module's blast radius inside one folder.

**Permitted flat (the only exceptions):**

- the package root `src/index.ts`;
- `types/` — shared cross-feature types, flat (`types/<name>.types.ts`);
- `constants/index.ts`;
- a category folder that holds **exactly one** impl file already named for it (e.g. `error-codes/error-codes.ts`) — this is itself a one-file folder, so it complies.

**Verification (zero output expected):**

```bash
find packages/<category>/<pkg>/src -type d | while read -r d; do
  n=$(find "$d" -maxdepth 1 -name '*.ts' \
        ! -name '*.test.ts' ! -name '*.types.ts' ! -name 'index.ts' | wc -l)
  [ "$n" -gt 1 ] && echo "JUNK DRAWER: $d ($n impl files)"
done
```

If the command prints anything, split each offending file into its own `<feature>/` folder — move the implementation, its test, and its doc together, then fix the relative imports — before the change ships.

---

## 4. Subpath exports per feature module

Every feature directory must have its own entry in `package.json` `exports`. A single `"."` barrel is insufficient. The subpath count should match the feature module count.

Verify entry points import nothing with side effects (telemetry registration, global state mutations). A `sideEffects: false` declaration with a leaking side effect is a silent bug.

---

## 5. Barrel exports — explicit named only

See **CLAUDE.md §6.4**. Feature barrels MUST use explicit named exports; `export *` is allowed only in generated forwarder files and top-level namespace re-exports.

---

## 6. Coverage thresholds

**100 / 100 / 100 / 100** for every package, no exceptions, no "foundation only" carve-out:

```ts
thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 }
```

The pre-publish gate MUST hard-fail below 100%. Mutation, contract, and property/fuzz testing layer on top — they do not substitute, and 100% line coverage does not substitute for them.

### Never delete code to make coverage pass

See **CLAUDE.md §8.3**. When a path is uncovered, write a test that exercises real behavior — do NOT delete defensive guards, rollback helpers, or catch arms.

---

## 7. Test runner imports — mandatory

All test files MUST import runner primitives (`describe`, `it`, `expect`, `vi`, `beforeAll`/`beforeEach`/`afterAll`/`afterEach`, etc.) from `@suaveplan/testing/runner`, the published conditional-export wrapper:

```ts
// CORRECT — runner-neutral
import { describe, expect, it, vi } from "@suaveplan/testing/runner";

// BANNED — pins the test file to one runner
import { describe, expect, it } from "bun:test";
import { describe, expect, it } from "vitest";
```

The wrapper is a conditional-export barrel: `bun` condition → re-exports `bun:test`; `default` / `vitest` condition → re-exports `vitest`. Tests then execute identically under either runner. This applies to test files under `packages/<category>/<pkg>/src/`; root-level `scripts/` tooling tests are outside the package workspace and are exempt.

**Exempt allowlist** (within `packages/`): only the wrapper-authoring packages (a future in-repo `testing`/`testing-dom`/`testing-e2e` family, if this project ever forks its own wrapper instead of consuming `@suaveplan/testing` directly). Configured in `scripts/lib/config.ts`'s `CONFIG.testing.exemptRunnerWrapperPackages` — empty by default. Adding a package to the allowlist requires its own OpenSpec change with justification.

**Migration prerequisite**: when migrating any library from upstream, every `from "vitest"` / `from "bun:test"` import MUST be rewritten to the wrapper **inside the migration commit, not as a follow-up**. Same rule applies when porting test files between packages or when an LLM agent generates a fresh test file.

**Verification grep** (zero output for any non-exempt package):

```bash
grep -rnE "from ['\"](vitest|bun:test)['\"]" \
  packages/<category>/<pkg>/src/ --include="*.ts" --include="*.tsx"
```

A repo-wide CI lint gate must run this across every non-exempt package on every commit. Code review must independently flag direct runner imports — relying solely on CI is how 19 packages drifted before the gate existed.

### Test structure

Arrange-Act-Assert. Name tests after **behavior**, not implementation. See CLAUDE.md §10.2.

---

## 8. Task-runner filtering reference

```bash
bunx turbo test --filter=<pkg>          # one package
bunx turbo test --filter=<pkg>...       # pkg + its deps
bunx turbo test --filter=...<pkg>       # pkg + its dependents
bunx turbo test --filter=...[main]      # changed since main
bunx turbo test --filter=...[HEAD^1]    # changed in last commit
bunx turbo test --filter={a,b,c}        # multiple (OR)
bunx turbo test --filter=!<pkg>         # exclude
```

---

## 9. Benchmarks

Every package should include benchmarks in `src/__benchmarks__/`. Use Markdown profiling output (CPU + heap) for LLM-assisted analysis. Publish baseline numbers in README.

---

## 10. Non-redundant path naming

A file or folder name must **not** contain the singular or plural form of any ancestor folder. See CLAUDE.md §6.2 for the rule and table.

Check:

```bash
find packages/<category>/<pkg>/src -type d | awk -F/ '
  NF>=2 {
    parent=$(NF-1); child=$NF
    singular=parent; sub(/ies$/, "y", singular); sub(/s$/, "", singular)
    if (index(child, singular) > 0) print $0
  }
'
```

---

## 11. Type design — no inline shapes

See **CLAUDE.md §12**. Named interfaces/types only — no nested object literals in interfaces; no inline shapes in function signatures. Cross-package types live in the shared zero-dep types package.

---

## 12. Clean workspace

Before declaring any task done:

- Remove scratch files, debug outputs, temporary artifacts.
- Verify `git status` shows only intentional changes.

## 12a. Spec-completeness verification — before any gate

**Never trust a compaction summary, archive status, or status-dashboard badge as proof that work is complete.** The only source of truth is the change's own `tasks.md` and `design.md`.

Before running ANY command in §13, manually:

1. **Open the change's `tasks.md`.** For migrations, also open the upstream `tasks.md`.
2. **Walk every task item.** For each item that claims a file/module/type/feature exists, verify it is present. A task that says "Implement `geo/distance` — `greatCircleDistance` and `vincentyDistance`" means BOTH functions must exist, have tests, have docs, and be exported from the barrel.
3. **For migrations, compare to upstream.** Diff the upstream `src/` against your equivalent. If upstream has `providers/admiralty/admiralty-provider.ts` with real fetch logic and yours has a 3-line stub, the migration is incomplete.
4. **Empty directories are a red flag, not cleanup.** If a directory exists in `src/` and is empty, it was scaffolded for a feature that was never implemented. **Implement and populate it** — do NOT delete the directory to make the tree look tidy.
5. **Cross-check against the parity checklist.** Every 🚫 row MUST have a written justification; every ⬆️ row must be real. If the table disagrees with the file tree, the table is wrong — fix the implementation, not the table.

If any task item is unchecked or unverified, the change is **not done**. Do not proceed to §13, do not archive, do not update the status dashboard.

---

## 13. Pre-ship verification sequence

Run in order — all must be green. **Step 0 is a hard gate; do not skip it.**

```bash
# 0. SPEC RECONCILIATION — NON-NEGOTIABLE. Run BEFORE any other gate.
#    Walk every `### Requirement` and `#### Scenario` in the spec delta.
#    For each requirement, grep the implementation to confirm the named
#    class, function, constant, span, counter, histogram, event, or error
#    code actually exists in src/. For each `**Verified by:**`, confirm
#    the test file exists and the test name matches *verbatim*.
#    If any requirement is unimplemented or any Verified-by is broken,
#    STOP. Do not run step 1.

# 1. Lint + typecheck + tests + format
bunx turbo lint typecheck test --filter=<pkg>
bunx biome check  # e.g. biome check --write --unsafe src/

# 2. Coverage at 100%
bunx turbo test:coverage --filter=<pkg>

# 3. Build
bunx turbo build --filter=<pkg>

# 4. Banned-pattern scan (zero output expected)
grep -rn "@deprecated\|TODO\|FIXME\|ts-ignore\|ts-expect-error\|\.skip\|\.only" \
  packages/<category>/<pkg>/src/ --include="*.ts"

# 4a. Barrel-shape scan (zero output for any feature barrel)
grep -rn "^\s*export\s\+\(type\s\+\)\?\*\s\+from" \
  packages/<category>/<pkg>/src/ --include="index.ts" \
  | grep -v "/src/index\.ts:" \
  | grep -v "\.select/" \
  | grep -v "export \* as"

# 4b. Test-runner import scan (zero output for non-exempt packages)
grep -rnE "from ['\"](vitest|bun:test)['\"]" \
  packages/<category>/<pkg>/src/ --include="*.ts" --include="*.tsx"

# 5. Missing .md scan
for f in $(find packages/<category>/<pkg>/src -name "*.ts" \
  ! -name "*.test.ts" ! -name "*.spec.ts" ! -name "*.types.ts" \
  ! -name "index.ts"); do
  md="${f%.ts}.md"; [ -f "$md" ] || echo "MISSING: $md"
done

# 6. README check
test -f packages/<category>/<pkg>/README.md && echo "README OK" || echo "MISSING README"

# 7. Bare-version check (zero output expected)
node -e "
  const p = JSON.parse(require('fs').readFileSync('packages/<category>/<pkg>/package.json','utf8'));
  const all = {...p.dependencies,...p.devDependencies,...p.peerDependencies};
  for (const [k,v] of Object.entries(all ?? {})) {
    if (typeof v === 'string' && /^[\^~]?\d/.test(v)) console.log('BARE VERSION:', k, v);
  }
"

# 8. Subpath export count
node -e "
  const p = JSON.parse(require('fs').readFileSync('packages/<category>/<pkg>/package.json','utf8'));
  const sub = Object.keys(p.exports ?? {}).filter(k => k.startsWith('./') && k !== '.');
  console.log('Subpath exports:', sub.length, sub);
"

# 9. Security scan — hardcoded secrets (zero output expected)
grep -rn \
  "password\s*=\s*['\"][^'\"]\|secret\s*=\s*['\"][^'\"]\|apiKey\s*=\s*['\"][^'\"]\|token\s*=\s*['\"][^'\"]" \
  packages/<category>/<pkg>/src/ --include="*.ts"

# 10. Dependent sweep — mandatory for foundation packages
bunx turbo test --filter=...<pkg>
```

For **foundation packages** (widely-consumed: error / types / events / logger / validation in this project's case), step 10 is mandatory — catches API-shape regressions BEFORE shipping. Green local tests do not prove you didn't break consumers.

For non-foundation packages, step 10 is optional — but if you altered the public surface, run it anyway. The cost is one command; the cost of skipping is finding out from a consumer's CI next week.

---

## 13a. Behavior-change propagation

See **CLAUDE.md §19**. When a change introduces consumer-visible behavior changes (new error code, renamed metric, method that now throws, default flipped, return shape change), you MUST:

1. **Self-doc**: update sibling `.md` + `README.md` Features section.
2. **Dependent surface scan**: `grep -rln "<old-name>" packages/ | grep -v "/dist/\|/<own-pkg>/"`. Every hit needs updating in the same change set.
3. **Migration note**: add `## Migration` to `proposal.md` listing (a) old behavior, (b) new behavior, (c) consumer search command, (d) recommended replacement.

Skipping any of these means a consumer somewhere is acting on an obsolete contract.

---

## 13b. Root-doc refresh + markdown-lint

Once §13 is green, but **before** archival (§14), refresh the repo-root manifest docs and run the markdown-lint pass.

Mandatory updates:

- **Auto-generated manifests** (`MANIFEST.md`, `MISSING.yml`, dep-graph indexes): run the generators.
- **Hand-edited status dashboard** (e.g. `STATUS.md`): move the package row from `Pending` → `Completed`, keeping icon and link conventions.
- **Hand-edited summary doc** (e.g. `SUMMARY.md`): update or add the per-package paragraph to reflect the shipped surface.
- **Migration narrative** (e.g. `MIGRATION.md`): update only if the change affects it.

Then auto-fix markdown:

```bash
bunx markdownlint-cli2 --fix
```

Re-stage anything the lint pass modified. Verify `git status` shows only intentional changes before archiving. If unfixable violations remain, resolve them by hand — never ship with lint failures, never silence with inline disables.

Verification before archival:

```bash
git status              # only intentional changes
git diff MANIFEST.md MISSING.yml STATUS.md SUMMARY.md MIGRATION.md
bunx markdownlint-cli2  # second pass, no --fix — must exit 0
```

---

## 14. OpenSpec archival

After all gates pass:

1. **Fold** the spec delta into `openspec/specs/<capability>/spec.md`.
2. **Move** `openspec/changes/<change-id>/` → `openspec/archive/<yyyy-mm-dd>-<change-id>/`.

---

## 14a. Proposal must list affected dependents

Every `proposal.md` MUST contain an `## Impact` section that explicitly enumerates downstream packages and what was done in each:

```markdown
## Impact

### Affected dependents

Run `bunx turbo ls --filter=...<pkg>` to enumerate. For each dependent, check one box:

- `<dep-1>` — [ ] tests run / [ ] docs reviewed / [x] no action needed (reason: …)
- `<dep-2>` — [x] tests run / [x] docs reviewed / [ ] no action needed
- `<dep-3>` — …

If `tests run` is unchecked for any dependent, the change MUST NOT be folded into the canonical spec — finish that work first or split the proposal.
```

The "no action needed" path requires a one-line reason (e.g. "consumer doesn't touch the changed surface"). It is NOT a free pass; it documents the conscious decision for the next agent reading the archive.

For **foundation packages**, the Affected-dependents list is non-optional. For non-foundation packages with zero dependents, write: "No dependents (verified by `bunx turbo ls --filter=...<pkg>`)."

Combined with §13 step 10 (dependent sweep) and §13a (behavior-change propagation), this closes the loop: the proposal names the blast radius, the verification proves the blast radius compiles and tests, and the migration note tells future readers what changed and how to adapt.

---

## 15. Cross-package contracts must live in contract packages

A type or interface that **packages other than the defining one are expected to implement** is a contract. Contracts MUST live in a shared, zero/near-zero-dep contract package (a `types`/`contracts`/`api-types` package — whatever your project's canonical types-only package is called), NOT inside the implementation package that consumes them.

Rationale: when an interface like `Router` is defined inside `host/src/request-pipeline/`, adapter authors (writing `router-hono`, `router-express`, etc.) never see it during code review. They satisfy `host`'s contract by structural typing, ship at 100% coverage, and the seam silently drifts. The first end-to-end boot is when the gap surfaces — too late.

### Lint gate

```bash
# A type that is implemented by another package must NOT be
# defined inside the consumer's src/.
<script-runner> scripts/lint/check-cross-package-contracts.ts
```

Walk every `interface X` / `type X = ...` declaration in each package's `src/` whose name appears as `implements X` or `: X` in ANOTHER package's `src/`. If the defining package is NOT the canonical contract package for the relevant family, fail.

### How to fix a violation

1. **Move the type definition** to the contract package (or create one if the family doesn't have one).
2. **Re-export from the original site** if back-compat for in-repo consumers matters: `export type { X } from "<contract-pkg>/<subpath>"` at the original location.
3. **Update the spec** of both packages: the contract package's spec gains a `### Requirement` for the type; the consuming package's spec uses `**Imports:** <contract-pkg>#X` (see §16).

### Allowed exceptions

- Private types that are NOT implementation contracts (purely internal data shapes). Only flag types appearing as `implements`/`satisfies`/`:` bound in another package.
- Types deliberately kept narrow that NO external package implements. Document the intent in the package's `README.md` so the next reviewer understands why the type doesn't move.

---

## 16. Conformance harnesses live with the contract, not the implementation

When a contract package exports `X`, it MUST also export a runnable conformance harness `runXConformance(factory)` from its `./testing` subpath. Every package that ships a concrete implementation of `X` MUST include a `tests/conformance/<name>.test.ts` that imports the harness and asserts compliance.

### Rules

1. **The harness lives in the contract package.** The package that defines `Router` exports `runRouterConformance`. The harness is the contract's executable form.
2. **Every implementing package's pre-publish gate (§13) MUST run the harness against the impl.** Verified by file presence (`tests/conformance/<contract-name>.test.ts`) and by the harness's own assertions passing.
3. **A package implementing MULTIPLE contracts** ships ONE conformance test per contract. Example: an adapter that satisfies both `Router` and `PipelineRouter` ships `tests/conformance/router.test.ts` AND `tests/conformance/pipeline-router.test.ts`.
4. **Adapters that ship both a direct and a proxied/worker surface** carry conformance under BOTH — same harness, invoked twice: once against the direct factory, once against the proxy factory.

### Lint gate

```bash
<script-runner> scripts/lint/check-conformance-tests.ts
```

For every package whose `package.json` `dependencies` references a contract-bearing package (detected by the dep also exporting a `./testing` subpath with a `runXxxConformance` function), assert the consumer has a matching `tests/conformance/<contract>.test.ts`. Fail the gate if missing.

### Spec-delta annotation

When a `### Requirement` in a spec delta describes implementing a contract from another package, the Requirement body MUST include an `**Imports:**` line:

```markdown
### Requirement: HonoRouter satisfies PipelineRouter

**Imports:** `<host-pkg>#PipelineRouter`, `<host-pkg>#PipelineRoute`

The exported `HonoRouter` class MUST implement every method of the
`PipelineRouter` interface from `<host-pkg>`. Verified by the shipped
`runPipelineRouterConformance` harness invoked against `createHonoRouter()`
in `tests/conformance/pipeline-router.test.ts`.

#### Scenario: register + matchPipeline round-trip

**Verified by:** `tests/conformance/pipeline-router.test.ts::"register + matchPipeline round-trip"`

- **WHEN** a route is registered with `registerPipelineRoute({ plugin, method, path, handler })`
- **AND** `matchPipeline({ method, path })` is invoked
- **THEN** the returned `PipelineRoute` MUST carry the original `plugin`, the supplied `handler`, and an empty `statusMap` when none was provided.
```

Reviewers (and, where wired, an OpenSpec conformance script) check every `**Imports:**` line against the named package's exports. Upstream `openspec validate <change-id> --strict` does not itself resolve `**Imports:**` symbols — treat a missing or mistyped import as a hard fail regardless, review-enforced.

---

## 17. Umbrella changes ship per-stage integration smoke

Every multi-package umbrella change that ships an architecture in stages MUST include a `## Integration smoke` section per stage. A stage is NOT "done" — and the next stage MUST NOT begin — until its integration smoke is green.

### What "integration smoke" means

A test that boots a real composition of the stage's packages and exercises the cross-package seams. It lives in a top-level `e2e/<umbrella>-stage-<N>/` workspace package, owns its `package.json` and E2E config, `src/` for the harness, and `tests/` for the assertions.

The umbrella's `tasks.md` includes per-stage rows:

```markdown
- [ ] Stage N smoke: `e2e/<umbrella>-stage-N/` boots a real composition and passes the conformance checklist (routes, lifecycle, error envelope, adapter slots).
```

The stage's "Verified by" pointer is the smoke's spec, not just the per-package conformance harnesses.

### Why per-package conformance is not enough

Per-package conformance proves each package satisfies its OWN contract. Per-stage integration smoke proves the packages COMPOSE — that adapter slots line up with host expectations, contract types are mutually assignable across the seam, and the request pipeline drives end-to-end without hand-wired shims.

The canonical failure mode this guards against: every package green at 100% coverage, and the foundation still doesn't compose — because integration smoke was deferred.

### Smoke fail = stage incomplete

If the smoke needs hand-wired adapter shims to boot, the stage is incomplete. Open coherence-fix changes against the gap-bearing packages — do NOT paper over with shims in the smoke. The smoke must consume the canonical adapter surface a real consumer would.

### Smoke is not exempt from coverage gates

The smoke package itself ships at 100% coverage on its own `src/` (the boot wiring + the fixture plugin). Its `tests/` are E2E specs and don't contribute to coverage — they ARE the gate.

---

## 18. Per-stage closure smoke is a stage deliverable, not an umbrella afterthought

§17 mandates per-stage integration smoke. §18 specifies **when** it must be authored: alongside the stage's packages, not deferred to "we'll do it once the umbrella closes".

### The mandate

Every stage of an umbrella change MUST list its closure smoke as a checkbox INSIDE the stage's own `tasks.md` block, dispatched in the same wave as the stage's packages. The umbrella's gate row in `## 2. Stage acceptance gates` is the OUTCOME line, not the deliverable spec.

Concretely, in any umbrella `tasks.md` Section 1:

```markdown
### Stage N — <description>

- [ ] N.1 `pkg-a`
- [ ] N.2 `pkg-b`
- [ ] N.3 `pkg-c`
- [ ] N.0 `e2e/<umbrella>-stage-N/` closure smoke — boots all of Stage-N's packages, drives the cross-package seam, MUST be authored as an OpenSpec change of its own (`openspec/changes/e2e-<umbrella>-stage-N/`) and dispatched in parallel with N.1..N.k
```

The `N.0` row exists from the day the umbrella is opened. It is NOT permitted to be added retroactively once the stage's packages are already shipped.

### Why authoring upfront, not at gate-close time

Deferring closure smoke to after the stage's packages ship risks a specific failure mode: every per-package conformance green, and the cross-package composition not working — because the integration test was the FIRST thing that exercised the composition, and by then the contracts had drifted in incompatible ways across the packages.

Authoring the closure smoke alongside the stage forces the cross-package contracts to be designed upfront. The smoke is the consumer that proves the contracts are mutually assignable; without it, each package's author optimises for their own package's tests.

### Carry-forward dependencies

A closure smoke MAY carry forward from a prior stage's smoke. When it does:

- The Verified-by line in the umbrella's gate row MUST cite the prior smoke's archive path.
- A carry-forward from `[ ]` (unshipped) gate to `[ ]` gate is **forbidden**. The earlier gate closes first. A lint script can enforce this if your project automates it.

### Dispatch order

When opening an umbrella OpenSpec change, the per-stage `N.0` smoke is the LAST agent dispatched per stage — every other Stage-N package agent runs in parallel BEFORE the smoke. The smoke needs the packages to exist (or its dependencies will fail to resolve). But it MUST be authored, proposal-archived, and dispatched within the same calendar wave as the stage's packages, not weeks later when the umbrella's gate row is the only thing anyone is looking at.

---

## 19. Primitive packages ship with their host-integration design

A pattern worth guarding against: a "primitive" package (a sandbox, an isolation tier, a transport, a storage backend, an auth provider) ships as a standalone runtime primitive with no integration into the host system that's supposed to consume it — the bridge layer was never designed.

### The rule

Every "primitive" package proposal (a package that supplies a runtime capability the rest of the system consumes) MUST identify, AT PROPOSAL TIME:

1. **The concrete consumer.** Which existing package will consume this primitive? Cite it by name + the subpath the consumer imports.
2. **The bridge layer (if any).** If the primitive's surface is not directly compatible with the consumer's expected input, the proposal MUST cite a `<primitive>-host-bridge` sibling package that mediates. The bridge package is shipped alongside the primitive, not later.
3. **The end-to-end test path.** Where in `e2e/<umbrella>-stage-N/` will this primitive be exercised? If the answer is "nowhere yet", the primitive is incomplete.

If any of (1), (2), (3) is missing from the primitive's proposal, the OpenSpec change is REJECTED at validate time. A lint script can enforce this on proposals whose path matches a configured primitive-package list.

### Why "later" is forbidden

"We'll add the bridge later" creates two artifacts that diverge: the primitive optimises for its own conformance harness; the bridge must invert later to match whatever shape the consumer ended up with. The contracts drift before they meet. Co-authoring forces the seam to be designed once.

---

## 20. Verified-by lines are mandatory at change-author time, not at archive time

Every requirement in every spec delta — and every umbrella gate row — MUST carry a `**Verified by:**` line pointing to a specific test file path AND a specific test title.

### Acceptable forms

```markdown
**Verified by:** `src/feature/feature.test.ts::"feature does the thing"`
**Verified by:** `tests/integration/composition.spec.ts::"full pipeline runs"` AND `src/api/api.test.ts::"surface matches contract"`
```

### Unacceptable forms

```markdown
**Verified by:** the test suite                    # vague — which test
**Verified by:** the conformance harness           # which harness
**Verified by:** (none yet)                        # rejected at validate
```

### Requirements that are not unit-test-shaped: `**Verified by (gate):**`

A minority of requirements are genuinely verified by a **gate**, not a runtime test — a build/typecheck/coverage/lint pass, a dependency-graph or package-shape check, a compile-time type check, a component-story presence gate, a container build, or a procedural smoke. For these a `path::"title"` citation would be a **false tick** (there is no such test). They MUST instead use the explicit `**Verified by (gate):**` marker, whose line MUST name a **concrete, runnable mechanism in backticks** — a command or a file/artifact path — never vague prose.

```markdown
**Verified by (gate):** `bunx turbo build --filter=<pkg>` emits the declared subpaths.
**Verified by (gate):** `bunx turbo typecheck --filter=<pkg>` (no forbidden imports under `src/`).
**Verified by (gate):** the `vitest.config.ts` thresholds block enforces 100% coverage.
**Verified by (gate):** the dependency-graph manifest shows no reverse edge into `<core-pkg>`.
```

Reserve `(gate)` for the cases above — reach for a real `**Verified by:**` test citation first, and only fall back to `(gate)` when no runtime test can honestly verify the requirement.

### When the test doesn't exist yet (TDD)

If authoring a fresh proposal, the test file path is the file you commit to creating in this change. The test title is the title you commit to giving the test. A lint script (if wired) runs at change-author time AND at archive time:

- **Author time** (when proposal is first committed): the file path MUST be syntactically valid (matches `(src|tests)/.../.test\.ts::"..."`). The file doesn't need to exist yet.
- **Archive time** (when change is moved to `archive/`): the file at the cited path MUST exist AND must contain a test whose title string-matches the cited title.

A Verified-by line whose cited test does not exist at archive time is a hard fail. The change cannot archive.

### Umbrella gate rows

Umbrella `tasks.md` gate rows MUST carry Verified-by lines too:

```markdown
- [ ] 2.7 Stage 7 ✓ — engines coexist on one host.
  **Verified by:** `e2e/foundation-stack-engines/tests/engines.spec.ts::"all engines accept requests on the same host"`
```

This makes "what does it mean for this gate to close" mechanically checkable.

---

## 21. Cross-package contracts authored before consumers

§15-16 say cross-package contracts live in contract packages and conformance harnesses colocate with the contract. §21 specifies **the ordering**: the contract package + conformance harness ship FIRST, before any consumer is dispatched.

### The mandate

For any feature requiring a contract shared between N packages:

1. **Contract package proposal lands first.** Defines the interface in the shared types package + ships the conformance harness in `<contract-pkg>/testing/`.
2. **Implementations dispatched after.** Each implementor's proposal cites the contract package's path + the conformance harness it must pass.
3. **Consumers dispatched after implementations.** Each consumer's proposal cites which implementations it expects to find at runtime AND uses the contract's TYPE (not a structural-mirror local type).

### Banned pattern: "structural mirror"

A package that mirrors a sibling's type as a local interface — "structurally compatible with `<contract-pkg>`'s `PipelineRouter`" — is BANNED. It looks like decoupling but is actually contract duplication, and the two surfaces drift.

Allowed only when:

- The contract package doesn't exist yet (in which case author it FIRST per this section).
- A genuine zero-dep optimisation matters (cite the bytes saved + the reviewer who approved). Otherwise: import the type directly.

Code review MUST flag any code-comment or `.md` documenting a structural mirror that lacks a cited contract-package follow-up change.

### Detection at agent dispatch

When dispatching a consumer agent (or a primitive agent), the orchestrator's brief MUST cite the contract package + conformance harness it'll use. If the agent reports "the contract isn't shipped" — STOP. The contract package's status is verified by the orchestrator before the consumer dispatch, not by the consumer agent at runtime.

A pre-dispatch shell snippet every consumer brief includes:

```bash
test -f openspec/specs/<contract-pkg>/spec.md || { echo "FATAL: <contract-pkg> not shipped — re-dispatch contract first"; exit 1; }
test -d packages/<contract-pkg>/src/testing || { echo "FATAL: <contract-pkg> conformance harness missing"; exit 1; }
```

This "shipped deps test" pattern prevents a consumer agent from looping against a dependency that was never actually shipped.

---

## 22. Apps must extract reusable capability into packages, shipped first

A pattern worth guarding against: an app absorbs functionality that would
clearly benefit other apps or future work — an auth flow, a caching layer,
a formatting utility, an API client, a UI primitive — and that
functionality never gets extracted, so it's either duplicated later or
permanently trapped inside one app's `src/`.

### The rule

Every OpenSpec change whose `proposal.md` carries a `**App**: <name>`
frontmatter line (naming an `apps/<name>/` target, parallel to the existing
`**Package**:` field for package changes) MUST include a
`## Reusable capability review` section, and MUST NOT also carry a
`**Package**:` line — apps and packages are always separate change folders
(§0c: one capability folder per package). A change needing both gets two folders.

That section must contain either:

- An explicit `None identified` line followed by a real, non-empty reason
  on the same line (e.g. `None identified — this app has no generic
  technical capability; it's a thin dashboard over an existing API`), or
- One or more package citations: a bullet list where each line starts with
  a single backtick-fenced package name, optionally followed by a short
  rationale on the same line (e.g. `` - `retry-client` — shared HTTP retry
  policy ``).

A bare `None identified` with no reason satisfies neither branch and is a
violation — the gate does not judge whether the reason is a *good* one,
only that a real justification was written down.

**Heuristic for "reusable"** (a judgment call for the proposal's author and
reviewer, not automated): a candidate for extraction is generic technical
capability — an auth flow, caching, formatting, an API client, a UI
primitive, a queue abstraction — rather than app-specific business logic;
something a plausible second app in this monorepo would also want; or
logic that would otherwise be duplicated.

### Ordering mandate

Every package named in the `## Reusable capability review` section MUST
already exist as a fully shipped OpenSpec change — a folder under
`openspec/archive/<yyyy-mm-dd>-<pkg>/` with `**Package**: <pkg>` in its
`proposal.md` — before the app's own change is allowed to archive. This
generalizes §21's "contract package ships before consumers" ordering from
shared type contracts to any reusable capability.

Extracted packages go through the exact same process as any other package
(`CLAUDE.md` §2, the `pkg-new` skill): their own `openspec/changes/<pkg>/`
folder, proposed and shipped independently — never folded into the app's
own change folder.

This gate runs as part of the aggregate `bun run lint` (see §3), and every
change is expected to pass `bun run lint` before archiving (per the
pre-ship sequence in §13) — so an app change cannot reach archive while it
cites an unshipped package. There is no separate `--mode=archive` variant
the way §20's gate has, because this check is only ever meaningful before
archival.

### Lint gate

```bash
bun scripts/lint/check-app-extraction.ts
```

For every `openspec/changes/*/proposal.md` carrying `**App**: <name>`:

- Also carries `**Package**:` → violation (apps and packages must be
  separate change folders).
- Missing `## Reusable capability review` section → violation.
- Section present but neither a `None identified` line with a real reason
  nor any package citation → violation.
- Any cited package with no matching `**Package**: <name>` in
  `openspec/archive/*/proposal.md` → violation naming the unshipped
  package.
