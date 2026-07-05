# App Package Extraction Gate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new OpenSpec rule (`openspec/AGENTS.md` §22) and an automated lint gate requiring every app proposal to review whether it should extract reusable capability into a package, and requiring any cited package to already be fully shipped before the app's own change can archive.

**Architecture:** A new `scripts/lint/check-app-extraction.ts` follows `check-verified-by.ts`'s shape — a pure `scanProposal(source)` core (unit-tested directly) plus a thin `main()` I/O shell that globs `openspec/changes/*/proposal.md`, cross-references `openspec/archive/*/proposal.md` for shipped packages, and prints violations. Wired into `package.json`'s `lint` aggregate and `turbo.json`, documented in `scripts/README.md` and the `monorepo-scripts` skill.

**Tech Stack:** Bun (script runtime, `Bun.Glob`, `bun:test`), TypeScript, regex-based markdown scanning (no AST parser — matches every sibling script in `scripts/lint/`).

**Reference:** Full design, including 5 rounds of adversarially-verified regex behavior, lives at `docs/superpowers/specs/2026-07-05-app-package-extraction-design.md`. This plan transcribes that design into exact file edits — read the design doc's §2 if you want the reasoning behind any specific regex.

---

## Chunk 1: Policy doc, gate script (TDD), and wiring

### Task 1: Document the policy — `openspec/AGENTS.md` §22

**Files:**
- Modify: `openspec/AGENTS.md` (append after §21, which currently ends at line 842)

- [ ] **Step 1: Append the §22 section**

Append this exact text to the end of `openspec/AGENTS.md` (after a blank line and a `---` separator, matching how every other top-level section in this file is separated). Note the outer wrapper below uses **4 backticks** (` ```` `), not 3 — the appended content itself contains a nested 3-backtick ` ```bash ` example, and a 3-backtick outer fence would be prematurely closed by that inner fence's closing delimiter (CommonMark only checks backtick *count*, not the info string). Only the text *inside* the 4-backtick wrapper is what gets appended to `openspec/AGENTS.md` — the wrapper itself is this plan's display device, not part of the appended content:

````markdown

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
````

- [ ] **Step 2: Verify placement**

Run: `tail -70 openspec/AGENTS.md`
Expected: the new §22 section appears in full, correctly formatted, after §21's last line ("This 'shipped deps test' pattern prevents a consumer agent from looping against a dependency that was never actually shipped.").

Run: `grep -c "^## 22\." openspec/AGENTS.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add openspec/AGENTS.md
git commit -m "docs: add openspec/AGENTS.md §22 - apps extract reusable capability into packages, shipped first"
```

---

### Task 2: Write the failing test file for `scanProposal`

**Files:**
- Create: `scripts/lint/check-app-extraction.test.ts`

- [ ] **Step 1: Write the full test file**

Create `scripts/lint/check-app-extraction.test.ts` with this exact content:

```ts
/**
 * Unit test for check-app-extraction.ts (the §22 app-package-extraction gate).
 *
 * Run with: `bun test scripts/lint/check-app-extraction.test.ts`
 *
 * This imports the runner directly from `bun:test` rather than
 * `@suaveplan/testing/runner` — openspec/AGENTS.md §7 governs
 * `packages/<category>/<pkg>/src/**\/*.test.ts`, not root `scripts/`
 * tooling, which is outside the package workspace and exempt.
 *
 * The pure `scanProposal` core is exercised directly with inline proposal.md
 * fixtures; the file-I/O layer (`main`) is exercised end-to-end by running
 * the gate for real (see Task 4 of the implementation plan / scripts/README.md).
 */

import { describe, expect, it } from "bun:test";

import { scanProposal } from "./check-app-extraction.ts";

describe("check-app-extraction / scanProposal", () => {
    it(
        "returns undefined when the proposal carries no **App**: line",
        { timeout: 5000 },
        () => {
            const source = [
                "**Package**: some-pkg",
                "",
                "## Why",
                "",
                "Some prose.",
                "",
            ].join("\n");
            expect(scanProposal(source)).toBeUndefined();
        }
    );

    it(
        "reports hasSection: false when the review section heading is missing",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Why",
                "",
                "Some prose.",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.appName).toBe("my-app");
            expect(scan?.hasSection).toBe(false);
        }
    );

    it(
        "flags a proposal that carries both **App**: and **Package**:",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "**Package**: my-app",
                "",
                "## Reusable capability review",
                "",
                "None identified — thin dashboard, nothing generalizable.",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.hasConflictingPackageField).toBe(true);
        }
    );

    it(
        "accepts a None identified line with a real same-line reason",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "None identified — this app has no generic technical capability; it's a thin dashboard over an existing API.",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.hasSection).toBe(true);
            expect(scan?.noneIdentified).toBe(true);
            expect(scan?.citedPackages).toEqual([]);
        }
    );

    it(
        "rejects a bare None identified line with no reason",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "None identified",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.noneIdentified).toBe(false);
            expect(scan?.citedPackages).toEqual([]);
        }
    );

    it(
        "ignores a None identified phrase that only appears inside a fenced code example",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "Here's an example of what NOT to write:",
                "",
                "```markdown",
                "None identified",
                "```",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.noneIdentified).toBe(false);
        }
    );

    it(
        "rejects a bare None identified followed by an unrelated bullet list",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "None identified",
                "",
                "- some unrelated bullet point",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.noneIdentified).toBe(false);
        }
    );

    it(
        "rejects a bare None identified followed by a --- separator rule",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "None identified",
                "",
                "---",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.noneIdentified).toBe(false);
        }
    );

    it(
        "captures backtick-fenced package names cited as bare bullet lines",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "- `retry-client`",
                "- `@suaveplan/http-cache`",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.citedPackages).toEqual(["retry-client", "http-cache"]);
        }
    );

    it(
        "captures a citation with trailing rationale text after the backtick",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "- `retry-client` — shared HTTP retry policy",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.citedPackages).toEqual(["retry-client"]);
        }
    );

    it(
        "does not miscapture an incidental tool-name mention inside a None identified reason",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "None identified — reviewed via the `pkg-new` skill; we also checked whether `bun` itself needed wrapping.",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.noneIdentified).toBe(true);
            expect(scan?.citedPackages).toEqual([]);
        }
    );

    it(
        "reaches real content after a fenced example inside the section that embeds a ## line",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "```markdown",
                "## fenced heading, not real",
                "None identified",
                "```",
                "",
                "None identified — real reason here, after the fence.",
                "",
                "## Next section",
                "irrelevant",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.hasSection).toBe(true);
            expect(scan?.noneIdentified).toBe(true);
        }
    );

    it(
        "finds the real section instead of a decoy heading quoted in an earlier fenced block",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Background",
                "",
                "For reviewer context, here's the rule text this proposal follows:",
                "",
                "```markdown",
                "## Reusable capability review",
                "",
                "- `decoy-pkg`",
                "```",
                "",
                "## Reusable capability review",
                "",
                "None identified — this app has no generic technical capability.",
                "",
                "## Next section",
                "irrelevant",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.noneIdentified).toBe(true);
            expect(scan?.citedPackages).toEqual([]);
        }
    );

    it(
        "reports hasSection: false when only a decoy heading exists, inside a fence",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "```markdown",
                "## Reusable capability review",
                "- `decoy-pkg`",
                "```",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.hasSection).toBe(false);
        }
    );

    it(
        "finds the real section instead of a decoy heading quoted in an earlier HTML comment",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "<!--",
                "## Reusable capability review",
                "- `decoy-pkg`",
                "-->",
                "",
                "## Reusable capability review",
                "",
                "None identified — this app has no generic technical capability.",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.noneIdentified).toBe(true);
            expect(scan?.citedPackages).toEqual([]);
        }
    );

    it(
        "doesn't truncate the section early on a commented-out draft heading inside it",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "<!-- ## some draft heading, commented out -->",
                "",
                "None identified — real reason here.",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.noneIdentified).toBe(true);
        }
    );

    it(
        "does not leak a citation-shaped line from a 4-space-indented illustrative example",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "None identified — this app has no generic technical capability.",
                "",
                "Example of what not to write:",
                "",
                "    - `example-pkg` — illustration only",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.citedPackages).toEqual([]);
        }
    );

    it(
        "reports the violation shape when the section has neither a valid reason nor any citation",
        { timeout: 5000 },
        () => {
            const source = [
                "**App**: my-app",
                "",
                "## Reusable capability review",
                "",
                "We haven't decided yet.",
            ].join("\n");
            const scan = scanProposal(source);
            expect(scan?.hasSection).toBe(true);
            expect(scan?.noneIdentified).toBe(false);
            expect(scan?.citedPackages).toEqual([]);
        }
    );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test scripts/lint/check-app-extraction.test.ts`
Expected: FAIL — module resolution error, something like `Cannot find module './check-app-extraction.ts'` (the implementation file doesn't exist yet).

- [ ] **Step 3: Format the file**

Run: `bunx biome check --write scripts/lint/check-app-extraction.test.ts`
Expected: reports 1 file checked, applies formatting fixes (this repo's Biome config reformats multi-line `it(name, { timeout: 5000 }, fn)` calls — matching the already-shipped `check-verified-by.test.ts`'s style). Re-run `bun test scripts/lint/check-app-extraction.test.ts` afterward to confirm it still fails the same way (formatting must not change behavior).

- [ ] **Step 4: Commit**

```bash
git add scripts/lint/check-app-extraction.test.ts
git commit -m "test: add failing tests for check-app-extraction scanProposal"
```

---

### Task 3: Implement `scanProposal` to make the tests pass

**Files:**
- Create: `scripts/lint/check-app-extraction.ts` (pure core only in this task — `main()` comes in Task 4)

- [ ] **Step 1: Write the implementation**

Create `scripts/lint/check-app-extraction.ts` with this exact content:

```ts
#!/usr/bin/env bun
/**
 * Enforce §22 of `openspec/AGENTS.md`: an app change (a `proposal.md`
 * carrying `**App**: <name>` frontmatter) MUST include a `## Reusable
 * capability review` section, MUST NOT also carry `**Package**:`, and
 * every package cited in that section MUST already exist as a fully
 * shipped OpenSpec change — a folder under `openspec/archive/` whose
 * `proposal.md` carries `**Package**: <pkg>`.
 *
 * Usage:
 *   bun scripts/lint/check-app-extraction.ts
 *
 * Exit codes: 0 = no violations, 1 = at least one violation.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

// See check-verified-by.ts for why `fileURLToPath(import.meta.url)` is used
// instead of Bun's `import.meta.dir` extension (portability under a
// bundler/transform layer such as vitest).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ProposalScan {
    readonly appName: string;
    readonly hasConflictingPackageField: boolean;
    readonly hasSection: boolean;
    readonly noneIdentified: boolean;
    readonly citedPackages: readonly string[];
}

const APP_FIELD_RE = /^\s*-?\s*\*\*App\*\*:\s*`?([^`\n]+?)`?\s*$/m;
const PACKAGE_FIELD_RE =
    /^\s*-?\s*\*\*Package\*\*:\s*`?(?:@[^/`]+\/)?([^`\n]+?)`?\s*$/m;

const SECTION_HEADING_RE = /^## Reusable capability review\s*$/m;
const NEXT_HEADING_RE = /^##[ \t]/m;
const NONE_IDENTIFIED_RE = /^.*None identified[ \t]*[-—][ \t]*\S.*$/m;
const PACKAGE_CITATION_LINE_RE =
    /^[ \t]*-[ \t]+`(?:@[a-z0-9-]+\/)?([a-z0-9-]+)`.*$/gm;

/**
 * Strip fenced (``` / ~~~) code blocks, HTML comments, and 4-space/tab
 * indented lines from markdown before scanning it for headings or
 * assertions. Otherwise a quoted example, a commented-out draft, or an
 * illustrative indented snippet can masquerade as real content. Pragmatic,
 * not a full CommonMark parser — see
 * docs/superpowers/specs/2026-07-05-app-package-extraction-design.md §2
 * for the adversarial cases this guards against, and its documented
 * residual limitations (unclosed fences, en-dash in None-identified).
 */
function stripCodeBlocks(md: string): string {
    let out = md
        .replace(/```[\s\S]*?```/g, "")
        .replace(/~~~[\s\S]*?~~~/g, "")
        .replace(/<!--[\s\S]*?-->/g, "");
    out = out.replace(/^(?: {4}|\t).*$(?:\n(?: {4}|\t).*$)*/gm, "");
    return out;
}

/**
 * Locate `## Reusable capability review` and return its body (everything
 * up to the next `## ` heading, or EOF), or `undefined` if no real heading
 * is found. The whole source is stripped BEFORE the heading search runs —
 * not just the text after wherever it first matches — so a decoy heading
 * quoted inside a fenced block or HTML comment earlier in the file can
 * never win the match.
 */
function extractSection(source: string): string | undefined {
    const stripped = stripCodeBlocks(source);
    const headingMatch = SECTION_HEADING_RE.exec(stripped);
    if (!headingMatch) return undefined;
    const afterHeading = stripped.slice(
        headingMatch.index + headingMatch[0].length
    );
    const nextHeading = NEXT_HEADING_RE.exec(afterHeading);
    return nextHeading
        ? afterHeading.slice(0, nextHeading.index)
        : afterHeading;
}

function extractCitations(body: string): string[] {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    PACKAGE_CITATION_LINE_RE.lastIndex = 0;
    while ((m = PACKAGE_CITATION_LINE_RE.exec(body)) !== null) {
        if (m[1]) out.push(m[1]);
    }
    return [...new Set(out)];
}

/**
 * Pure line-scan of one proposal.md (no file I/O). Returns `undefined` when
 * the proposal carries no `**App**:` frontmatter line — not an app
 * proposal, nothing to check.
 */
export function scanProposal(source: string): ProposalScan | undefined {
    const frontmatter = source.split("\n").slice(0, 30).join("\n");
    const appMatch = APP_FIELD_RE.exec(frontmatter);
    if (!appMatch?.[1]) return undefined;

    const hasConflictingPackageField = PACKAGE_FIELD_RE.test(frontmatter);
    const section = extractSection(source);
    if (section === undefined) {
        return {
            appName: appMatch[1],
            hasConflictingPackageField,
            hasSection: false,
            noneIdentified: false,
            citedPackages: [],
        };
    }

    return {
        appName: appMatch[1],
        hasConflictingPackageField,
        hasSection: true,
        noneIdentified: NONE_IDENTIFIED_RE.test(section),
        citedPackages: extractCitations(section),
    };
}
```

Note: `main()` and the CLI entrypoint are intentionally not in this file yet — that's Task 4, so this task stays focused on making the current tests pass.

- [ ] **Step 2: Run the tests to verify they pass**

Run: `bun test scripts/lint/check-app-extraction.test.ts`
Expected: PASS — all 18 tests green, 0 failures.

- [ ] **Step 3: Format the file**

Run: `bunx biome check --write scripts/lint/check-app-extraction.ts`
Expected: reports 1 file checked, applies formatting fixes. Re-run `bun test scripts/lint/check-app-extraction.test.ts` afterward to confirm all 18 tests still pass (formatting must not change behavior).

- [ ] **Step 4: Commit**

```bash
git add scripts/lint/check-app-extraction.ts
git commit -m "feat: implement scanProposal for the app-extraction lint gate"
```

---

### Task 4: Implement the `main()` I/O shell and CLI entrypoint

**Files:**
- Modify: `scripts/lint/check-app-extraction.ts` (append to the end of the file)

- [ ] **Step 1: Append the I/O shell**

Append this exact content to the end of `scripts/lint/check-app-extraction.ts` (after the `scanProposal` function):

```ts

async function loadArchivedPackages(): Promise<ReadonlySet<string>> {
    const names = new Set<string>();
    const g = new Glob("openspec/archive/*/proposal.md");
    for await (const rel of g.scan({ cwd: REPO_ROOT })) {
        const abs = resolve(REPO_ROOT, rel);
        const source = await readFile(abs, "utf8");
        const frontmatter = source.split("\n").slice(0, 30).join("\n");
        const m = PACKAGE_FIELD_RE.exec(frontmatter);
        if (m?.[1]) names.add(m[1]);
    }
    return names;
}

async function main(): Promise<void> {
    const violations: string[] = [];
    const archivedPackages = await loadArchivedPackages();

    const g = new Glob("openspec/changes/*/proposal.md");
    let scanned = 0;
    for await (const rel of g.scan({ cwd: REPO_ROOT })) {
        const abs = resolve(REPO_ROOT, rel);
        const source = await readFile(abs, "utf8");
        const scan = scanProposal(source);
        if (scan === undefined) continue;
        scanned++;

        if (scan.hasConflictingPackageField) {
            violations.push(
                `${rel}  proposal for app '${scan.appName}' also carries **Package**: — apps and packages must be separate change folders (§0c)`
            );
        }
        if (!scan.hasSection) {
            violations.push(
                `${rel}  app '${scan.appName}' proposal.md lacks a '## Reusable capability review' section`
            );
            continue;
        }
        if (!scan.noneIdentified && scan.citedPackages.length === 0) {
            violations.push(
                `${rel}  app '${scan.appName}': section present but neither states 'None identified — <reason>' nor cites any package`
            );
        }
        for (const pkg of scan.citedPackages) {
            if (!archivedPackages.has(pkg)) {
                violations.push(
                    `${rel}  app '${scan.appName}' cites package '${pkg}' which is not yet shipped (no matching openspec/archive/*/proposal.md with **Package**: ${pkg})`
                );
            }
        }
    }

    if (violations.length === 0) {
        console.log(`OK  ${scanned} app proposal(s) scanned; no §22 violations.`);
        return;
    }
    console.error(`FAIL  ${violations.length} §22 violation(s):`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        "\n§22: every app proposal needs a '## Reusable capability review' section (a real 'None identified — <reason>' or package citations), and cited packages must already be archived."
    );
    process.exit(1);
}

if (import.meta.main) {
    await main();
}
```

- [ ] **Step 2: Run the gate for real**

Run: `bun scripts/lint/check-app-extraction.ts`
Expected: `OK  0 app proposal(s) scanned; no §22 violations.` and exit code `0` — `openspec/changes/` currently only contains `.gitkeep` (no real proposals) and `openspec/archive/` doesn't exist yet, so there is nothing to flag.

Run: `echo $?`
Expected: `0`

- [ ] **Step 3: Re-run the unit tests to confirm no regression**

Run: `bun test scripts/lint/check-app-extraction.test.ts`
Expected: PASS — same 18 tests green (this task only appended code after the tested exports; it must not change `scanProposal`'s behavior).

- [ ] **Step 4: Format the file**

Run: `bunx biome check --write scripts/lint/check-app-extraction.ts`
Expected: reports 1 file checked. Re-run `bun scripts/lint/check-app-extraction.ts` and `bun test scripts/lint/check-app-extraction.test.ts` afterward to confirm both still behave as in Steps 2-3.

- [ ] **Step 5: Commit**

```bash
git add scripts/lint/check-app-extraction.ts
git commit -m "feat: add main() I/O shell and CLI entrypoint for check-app-extraction"
```

---

### Task 5: Wire the gate into `package.json` and `turbo.json`

**Files:**
- Modify: `package.json:28` (the `lint` aggregate script) and add a new script entry near `package.json:37`
- Modify: `turbo.json` (add a new `//#lint:app-extraction` task, alongside the other `//#lint:*` tasks)
- Modify: `.vscode/tasks.json` (add a matching task — every `lint:*` script in `package.json` has a 1:1 hand-maintained task block here, no exceptions)

- [ ] **Step 1: Add the `lint:app-extraction` script and wire it into the aggregate**

In `package.json`, change:

```json
    "lint": "bunx turbo lint lint:test-runner-imports lint:feature-layout lint:cross-package-contracts lint:conformance-tests lint:carry-forward-deps lint:verified-by lint:stage-smoke lint:primitive-host-integration lint:docs-tree",
```

to:

```json
    "lint": "bunx turbo lint lint:test-runner-imports lint:feature-layout lint:cross-package-contracts lint:conformance-tests lint:carry-forward-deps lint:verified-by lint:stage-smoke lint:primitive-host-integration lint:app-extraction lint:docs-tree",
```

And, in the same file, change:

```json
    "lint:primitive-host-integration": "bun scripts/lint/check-primitive-host-integration.ts",
```

to:

```json
    "lint:primitive-host-integration": "bun scripts/lint/check-primitive-host-integration.ts",
    "lint:app-extraction": "bun scripts/lint/check-app-extraction.ts",
```

- [ ] **Step 2: Add the turbo task**

In `turbo.json`, find the `"//#lint:primitive-host-integration"` task block:

```json
    "//#lint:primitive-host-integration": {
      "inputs": [
        "scripts/lint/check-primitive-host-integration.ts",
        "scripts/lint/primitives.json",
        "openspec/changes/*/proposal.md"
      ],
      "outputs": [],
      "cache": true,
      "outputLogs": "errors-only"
    },
```

and add this new task block immediately after it (before `"//#lint:preflight"`):

```json
    "//#lint:app-extraction": {
      "inputs": [
        "scripts/lint/check-app-extraction.ts",
        "openspec/changes/*/proposal.md",
        "openspec/archive/*/proposal.md"
      ],
      "outputs": [],
      "cache": true,
      "outputLogs": "errors-only"
    },
```

- [ ] **Step 3: Add the matching VS Code task**

In `.vscode/tasks.json`, find the `"lint:primitive-host-integration"` task block:

```json
    {
      "label": "lint:primitive-host-integration",
      "type": "shell",
      "command": "bun run lint:primitive-host-integration"
    },
```

and add this new task block immediately after it (before the `"lint:preflight"` block):

```json
    {
      "label": "lint:app-extraction",
      "type": "shell",
      "command": "bun run lint:app-extraction"
    },
```

- [ ] **Step 4: Verify all three wiring points work**

Run: `bun run lint:app-extraction`
Expected: `$ bun scripts/lint/check-app-extraction.ts` followed by `OK  0 app proposal(s) scanned; no §22 violations.`, exit code `0`.

Run: `bun run lint`
Expected: all tasks succeed, including a `lint:app-extraction` line in turbo's task list; exit code `0`. (This also re-runs every other lint gate — if anything else in the repo broke, this step will surface it; investigate before proceeding if so.)

Run: `python3 -c "import json; json.load(open('.vscode/tasks.json')); print('valid JSON')"`
Expected: `valid JSON` (confirms the manual edit didn't break the file).

- [ ] **Step 5: Commit**

```bash
git add package.json turbo.json .vscode/tasks.json
git commit -m "feat: wire lint:app-extraction into the aggregate lint script, turbo, and VS Code tasks"
```

---

### Task 6: Document the new gate in `scripts/README.md` and the `monorepo-scripts` skill

**Files:**
- Modify: `scripts/README.md` (a new row in its "Quick reference" table near the top, and a new bullet in the `## \`lint/\`` section at `scripts/README.md:47` — goes first there, alphabetically before `check-carry-forward-deps.ts`)
- Modify: `.claude/skills/monorepo-scripts/SKILL.md` (a new row in the "Fast lookup: symptom → script" table — this file has only the one table)

- [ ] **Step 1: Add the script entry to `scripts/README.md`**

In `scripts/README.md`, find this line near the top (in the "Quick reference" table):

```markdown
| `lint:primitive-host-integration` | `lint/check-primitive-host-integration.ts` |
```

and add a new row immediately after it (matching the order Task 5 gives `lint:app-extraction` in the real `package.json` — immediately after `lint:primitive-host-integration`, before `lint:preflight` — so this table's order matches reality):

```markdown
| `lint:app-extraction` | `lint/check-app-extraction.ts` |
```

Then, in the `## \`lint/\`` section, find:

```markdown
## `lint/`

OpenSpec/CLAUDE.md rule gates. All read-only; all fail with exit `1` on violation unless noted.

- **`check-carry-forward-deps.ts`** — a `tasks.md` gate row marked "carry forward from gate 2.X" may not depend on another still-open gate row (or a nonexistent one).
```

and insert a new bullet immediately after the "All read-only..." sentence, before `check-carry-forward-deps.ts` (alphabetical order — "app" sorts before "carry"):

```markdown
- **`check-app-extraction.ts`** — enforces §22: an app proposal (`proposal.md` carrying `**App**: <name>`) must include a `## Reusable capability review` section (either `None identified — <reason>` or package citations), must not also carry `**Package**:`, and every cited package must already be shipped (a matching `**Package**: <name>` in `openspec/archive/*/proposal.md`). Companion `.test.ts` exercises the exported `scanProposal`.
```

- [ ] **Step 2: Add the row to the `monorepo-scripts` skill**

In `.claude/skills/monorepo-scripts/SKILL.md`, find this row in the "Fast lookup: symptom → script" table:

```markdown
| "primitive-host-integration" lint fails | `lint/check-primitive-host-integration.ts` | add the missing `## Concrete consumer` / `## Host bridge` / `## End-to-end test` section to `proposal.md` |
```

and add a new row immediately after it:

```markdown
| "app-extraction" lint fails | `lint/check-app-extraction.ts` | add a `## Reusable capability review` section to the app's `proposal.md` (either `None identified — <reason>` or package citations), and confirm every cited package has an archived OpenSpec change |
```

- [ ] **Step 3: Verify markdown lint passes on both files**

Run: `bunx markdownlint-cli2 "scripts/README.md" ".claude/skills/monorepo-scripts/SKILL.md" 2>&1 | grep -E "^scripts/README.md|^\.claude/skills/monorepo-scripts"`
Expected: no output (no findings for either file).

- [ ] **Step 4: Commit**

```bash
git add scripts/README.md .claude/skills/monorepo-scripts/SKILL.md
git commit -m "docs: document check-app-extraction.ts in scripts/README.md and the monorepo-scripts skill"
```

---

### Task 7: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite for the new script**

Run: `bun test scripts/lint/check-app-extraction.test.ts`
Expected: PASS, all 18 tests green.

- [ ] **Step 2: Run the full repo-wide lint gate**

Run: `bun run lint`
Expected: exit code `0`, all tasks (including `lint:app-extraction`) succeed.

- [ ] **Step 3: Confirm the working tree is clean**

Run: `git status --short`
Expected: empty output (everything from this plan has been committed; nothing stray).

- [ ] **Step 4: Confirm markdownlint is still clean repo-wide for the files this plan touched**

Run: `bunx markdownlint-cli2 "openspec/AGENTS.md" "scripts/README.md" ".claude/skills/monorepo-scripts/SKILL.md" 2>&1 | grep -E "^openspec/AGENTS.md|^scripts/README.md|^\.claude/skills/monorepo-scripts"`
Expected: no output.

This plan is complete once all 7 tasks' checkboxes are ticked and this final sweep is green.
