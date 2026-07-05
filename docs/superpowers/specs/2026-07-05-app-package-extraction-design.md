# Design: apps must extract reusable capability into packages, shipped first

**Date**: 2026-07-05
**Status**: Revised after spec review rounds 1–5; review loop closed per the 5-round cap (user confirmed) with two known, documented limitations left unfixed (see Non-goals) — ready for user review

## Problem

Nothing in this repo's OpenSpec process currently stops an app from absorbing functionality that clearly belongs in a reusable package — an auth flow, a caching layer, a formatting utility, an API client, a UI primitive. Without a forcing function, that logic either gets duplicated the first time a second app needs it, or stays permanently trapped inside one app's `src/`, unreachable and untested outside that app's own test suite.

§21 of `openspec/AGENTS.md` already solves an adjacent problem — shared *type contracts* must live in a contract package and ship before their consumers — but it's scoped to structural contracts (interfaces one package `implements`), not general reusable functionality an app happens to need. This design generalizes that ordering pattern (package proposal → package ships → consumer depends on it) to any reusable capability an app identifies during its own design.

## Scope decisions (confirmed with user)

1. **Enforcement**: automated lint gate, not documentation-only — matches how every other `openspec/AGENTS.md` rule in this repo works (§18/§19/§20 all have a `scripts/lint/check-*.ts` companion).
2. **Ordering strictness**: the extracted package's OpenSpec change must be fully **archived** (shipped — gates green, spec folded into `openspec/specs/`) before the app's own change is allowed to archive. Not just proposed-in-parallel; must be *done*.

## Spec review history

Five review rounds, each verifying claims by *executing* the regexes/algorithms against adversarial input rather than reading them — this caught real bugs that looked correct on inspection. Sections 1–4 below describe **only the final, current design**; this section is the audit trail. Round 5 found two more issues than the others (see below) and, per this project's cap on review iterations, the user chose a bounded fix pass over a 6th round — two minor, non-blocking gaps are consciously left as documented limitations in Non-goals rather than chased further.

**Round 1** (5 blocking issues): a wrong sibling-script citation (`check-primitive-host-integration.ts` isn't pure and has no test — `check-verified-by.ts` is the real shape model); a false claim that `conformance.ts`'s `findRelatedChangeFolders` (a presence-check with no capture group) could be reused for extraction; a fenced-code false-negative (scanning raw text let a quoted example of "None identified" count as a real assertion); §22's policy prose requiring "a one-sentence reason" while the gate didn't check for one; and no handling for a proposal carrying both `**App**:` and `**Package**:`.

**Round 2** (2 of round 1's fixes still broken, executed and confirmed): `NONE_IDENTIFIED_RE`'s `\s*` before the dash crossed line breaks, so a bare `None identified` followed by an unrelated bullet list or a `---` separator elsewhere in the section still matched; and the package-citation scan matched any backtick-quoted token anywhere in the section, capturing incidental tool-name mentions (e.g. `` `bun` ``) inside a valid reason as false citations. Both re-verified fixed by execution. Also fixed: a redundant scope-strip step, an "archive/ is empty" claim corrected to "doesn't exist yet", and a softened analogy to `check-verified-by.ts`'s `GATE_MECH_RE`.

**Round 3** (2 more issues found by execution, both fixed below): the citation regex required a *bare* line (name only) and silently dropped a citation written with trailing rationale text (e.g. `` - `retry-client` — used for auth ``) — a realistic authoring pattern neither documented as unsupported nor accepted; and the section-body extraction was only ever specified in prose ("find the heading, take everything until the next `## `"), never as fence-safe code, so a fenced example *inside* the review section that itself contained a `##`-prefixed line would truncate extraction early and silently drop real content after it — the same bug class as round 1's fenced-code issue, one level up. Round 3 also recommended consolidating the "round-N fixed X" narrative that had accumulated inline throughout §2 into this history section, leaving §1/§2/§4 as a clean statement of current behavior — done in that revision.

**Round 4** (1 more issue found by execution, fixed below): the round-3 `extractSection` fix stripped code fences only from the text *after* the located heading, but searched for the heading itself in the raw, un-stripped source — so a decoy `## Reusable capability review` heading quoted inside an earlier fenced block (a realistic pattern: a "Background" section quoting the new rule's own text for reviewer context, itself containing the heading string and an example citation) would win the match instead of the real section, silently substituting the decoy's content for the real one. Confirmed by execution: a proposal with a fully-compliant real section but a decoy quote above it produced the decoy's example citation instead of the real `None identified` reason. Fixed by stripping code fences from the *entire* source once, up front, before searching for the heading at all — re-verified this fix against the decoy case, an only-decoy-no-real-section case (correctly still `undefined`), and all prior rounds' cases with no regressions.

**Round 5** (2 more hiding vectors found by execution — same bug class as round 4's fenced decoy, via markdown constructs `stripCodeBlocks` didn't cover; plus 1 unenforced doc claim; fixed below, then review stopped per this project's cap of 5 rounds): (a) an HTML comment (`<!-- ... -->` — routinely used in this repo's `.md` files, since `.markdownlint-cli2.jsonc` explicitly permits raw HTML) can hide a decoy heading+citation exactly like round 4's fenced case, or truncate a real section early if a commented-out draft heading appears inside it; (b) a 4-space-indented illustrative example (CommonMark indented code, distinct from fenced code) can leak a citation-shaped line into `citedPackages` even though it was never meant as a real citation; (c) the doc's justification for accepting only `-` bullets ("markdownlint normalizes `*`/`+` before archival") doesn't hold up — root `package.json`'s `lint` script never runs `lint:md`/`lint:md:fix`, and `bun run lint` (carrying `lint:app-extraction`) is expected to run repeatedly through a change's life, not just once immediately pre-archival, so the exposure window is the norm, not an edge case. Fixed (a)/(b) by extending `stripCodeBlocks` to also strip HTML comments and 4-space/tab-indented line runs, re-verified against all of round 5's repro cases plus every prior round's case with no regressions (this is a pragmatic, non-exhaustive fix — it does not implement full CommonMark container-indentation semantics, e.g. indentation that's actually list-item continuation rather than a code block is not specially handled; not chasing further markdown-hiding mechanisms beyond this, per the review cap). Fixed (c) by rewording the citation-format documentation to state the `-`-only constraint as an authored convention, not an enforced guarantee.

## 1. Policy — new `openspec/AGENTS.md` §22

Placed immediately after §21 (its closest sibling). Full text to add:

```markdown
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
```

## 2. Gate script — `scripts/lint/check-app-extraction.ts`

**Detection pattern** (glob `openspec/changes/*/proposal.md`, scan for required markers, print violations, exit 1) matches `check-primitive-host-integration.ts`. **Code shape** (a pure parsing function, unit-tested directly, plus a thin file-walking `main()`) matches `check-verified-by.ts`'s actual `scanSpec` / `checkSpecFile`+`main` split.

### Pure core

```ts
interface ProposalScan {
  readonly appName: string;
  readonly hasConflictingPackageField: boolean;
  readonly hasSection: boolean;
  readonly noneIdentified: boolean;
  readonly citedPackages: readonly string[];
}

// Returns undefined when the proposal carries no `**App**:` frontmatter
// line — not an app proposal, nothing to check.
export function scanProposal(source: string): ProposalScan | undefined;
```

**Frontmatter fields** — only the first 30 lines are scanned (the exact bound `conformance.ts`'s `findRelatedChangeFolders` uses: `content.split("\n").slice(0, 30)`):

```ts
const APP_FIELD_RE = /^\s*-?\s*\*\*App\*\*:\s*`?([^`\n]+?)`?\s*$/m;
const PACKAGE_FIELD_RE = /^\s*-?\s*\*\*Package\*\*:\s*`?(?:@[^/`]+\/)?([^`\n]+?)`?\s*$/m;
```

`APP_FIELD_RE` has no match → `scanProposal` returns `undefined` (not an app proposal). App names are **not** scope-stripped (apps aren't published npm packages, so the name is used verbatim). `PACKAGE_FIELD_RE` matching against the same 30-line slice → `hasConflictingPackageField: true`. `PACKAGE_FIELD_RE`'s capture group already excludes the `@scope/` prefix (non-capturing group) — no separate scope-stripping step is needed anywhere this regex is used.

**Section extraction** — fence-safe by construction, and safe against a decoy heading: code fences are stripped from the **entire source once, up front** — before the heading search runs at all, not just on the text after wherever it matches. This matters because a fenced block *earlier* in the file can itself quote the heading text (e.g. a "Background" section quoting this very rule for reviewer context) — searching for the heading in raw text would let that decoy win the match instead of the real section. Stripping the whole source first removes the decoy along with everything else inside fences, so the search can only ever land on a real, unfenced heading:

```ts
function stripCodeBlocks(md: string): string {
  let out = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  // 4-space/tab-indented lines (CommonMark indented code) — a separate
  // hiding mechanism from fenced code, e.g. an illustrative "what not to
  // write" example. Pragmatic, not a full CommonMark parser: doesn't
  // distinguish real indented code from indentation that's actually list-
  // item continuation. Sufficient for this gate's purpose (don't let an
  // example masquerade as a real heading/citation/assertion).
  out = out.replace(/^(?: {4}|\t).*$(?:\n(?: {4}|\t).*$)*/gm, "");
  return out;
}

const SECTION_HEADING_RE = /^## Reusable capability review\s*$/m;
const NEXT_HEADING_RE = /^##[ \t]/m;

function extractSection(source: string): string | undefined {
  const stripped = stripCodeBlocks(source);
  const headingMatch = SECTION_HEADING_RE.exec(stripped);
  if (!headingMatch) return undefined;
  const afterHeading = stripped.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = NEXT_HEADING_RE.exec(afterHeading);
  return nextHeading ? afterHeading.slice(0, nextHeading.index) : afterHeading;
}
```

`hasSection` is `false` when `extractSection` returns `undefined` — this covers both "no heading at all" and "the only heading found was inside a fence and got stripped away."

**`None identified` + reason check** — a *single line* within the extracted (already fence-stripped) section body must match:

```ts
const NONE_IDENTIFIED_RE = /^.*None identified[ \t]*[-—][ \t]*\S.*$/m;
```

The phrase, a dash or em-dash, and at least one non-whitespace character, all on the same physical line — `[ \t]*` (horizontal whitespace only, not `\s*`) between the phrase and the dash is what forbids the match from crossing a line break to reach an unrelated dash elsewhere in the section (a following bullet list, or a `---` requirement separator). A bare `None identified` with nothing else on its line does not set `noneIdentified: true`. This is a syntactic presence check only, not a judgment of the reason's quality.

**Package citations** — a citation is a bullet line that *starts* with a single backtick-fenced package name, with anything (or nothing) allowed after the closing backtick on that line:

```ts
const PACKAGE_CITATION_LINE_RE = /^[ \t]*-[ \t]+`(?:@[a-z0-9-]+\/)?([a-z0-9-]+)`.*$/gm;

function extractCitations(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  PACKAGE_CITATION_LINE_RE.lastIndex = 0;
  while ((m = PACKAGE_CITATION_LINE_RE.exec(body)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return [...new Set(out)];
}
```

Only `-` bullets are recognized, not `*`/`+`. This repo's `.markdownlint-cli2.jsonc` does pin `MD004: { style: "dash" }`, but that is **not** an enforced guarantee ahead of this gate — `bun run lint` (which carries `lint:app-extraction`) does not itself run `lint:md`/`lint:md:fix`, and this gate is expected to run repeatedly through a change's life, not just once immediately pre-archival. So `-` is simply the documented authoring convention for citations (matching the policy prose in §1), not something the gate can assume is normalized for it; a `*`/`+` bullet citation, if ever authored, will not be recognized. Anchoring to "line starts with `- \`name\`\`" is what excludes incidental backtick-quoted tool/skill names appearing mid-sentence in ordinary prose (e.g. a `None identified` reason that happens to mention `` `bun` ``) — such mentions never start a bullet line with a backtick immediately after the dash, so they're never captured. A citation with leading prose before the backtick (e.g. `` - see `pkg-name` ``) is likewise not captured — citations must lead their bullet line.

### I/O shell (`main`)

1. Glob `openspec/changes/*/proposal.md` (active, unarchived only — an app change that has already archived already passed this check by definition).
2. For each, read + `scanProposal`. Skip `undefined` results (not an app proposal).
3. Build the archived-package set once: glob `openspec/archive/*/proposal.md`, apply `PACKAGE_FIELD_RE` to each file's first-30-lines slice, collect each match's capture group 1 into a `Set<string>`.
4. Violations, one entry per proposal that trips any of these (a single proposal can produce more than one violation line):
   - `hasConflictingPackageField === true` → "proposal for app '<name>' also carries **Package**: — apps and packages must be separate change folders (§0c)".
   - `hasSection === false` → "app '<name>' proposal.md lacks a '## Reusable capability review' section".
   - `hasSection === true`, `noneIdentified === false`, `citedPackages.length === 0` → "section present but neither states 'None identified — <reason>' nor cites any package".
   - Any `citedPackages` entry not in the archived-package set → "cited package '<pkg>' is not yet shipped (no matching openspec/archive/*/proposal.md with **Package**: <pkg>)" — fires once per unshipped package, independently for each app proposal that cites it.
5. Print violations to stderr, `process.exit(1)`; otherwise print an `OK` summary line (count of app proposals scanned) and exit 0 — same convention as every sibling `lint/check-*.ts`.

## 3. Wiring

- **`package.json`**: new `"lint:app-extraction": "bun scripts/lint/check-app-extraction.ts"`, added to the `lint` aggregate script's list (alongside the other `lint:*` subtask names) — this is what makes the "runs before every archival" guarantee in §1 real, not just asserted.
- **`turbo.json`**: new `//#lint:app-extraction` task, `inputs` covering the script itself plus `openspec/changes/*/proposal.md` and `openspec/archive/*/proposal.md` (both are read).
- **`scripts/README.md`**: new bullet under `## lint/`, matching the existing per-script documentation style (purpose, flags — none —, reads, exit codes).
- **`.claude/skills/monorepo-scripts/SKILL.md`**: new row in the "Fast lookup: symptom → script" table.

## 4. Testing

Companion `scripts/lint/check-app-extraction.test.ts`, following `check-verified-by.test.ts`'s pattern — imports `bun:test` directly (repo tooling, exempt from the runner-neutral-wrapper rule per `CLAUDE.md` rule 11's own carve-out for `scripts/`), exercises `scanProposal` directly with inline fixtures:

- Proposal with no `**App**:` line → returns `undefined`.
- `**App**:` present, no `## Reusable capability review` heading → `hasSection: false`.
- `**App**:` present alongside `**Package**:` → `hasConflictingPackageField: true`.
- Section present with a `None identified — <reason>` line → `noneIdentified: true`, `citedPackages: []`.
- Section present with a **bare** `None identified` and no reason → `noneIdentified: false`.
- Section body's only occurrence of "None identified" is inside a fenced ` ``` ` code example → `noneIdentified: false` (proves fence-stripping works).
- A bare `None identified` followed by a blank line and then an ordinary bullet list, and separately a bare `None identified` followed by a `---` separator rule → both `noneIdentified: false` (proves the line-anchor prevents crossing to an unrelated dash).
- Section present citing one or more backtick-fenced package names as bare bullet lines → `citedPackages` populated, scope-stripped, de-duplicated.
- A citation bullet with trailing rationale text after the closing backtick (e.g. `` - `retry-client` — used for auth ``) → still captured in `citedPackages` (proves trailing text doesn't silently drop a real citation).
- Section with a valid `None identified — <reason>` line whose reason prose also backtick-quotes an unrelated tool/skill name (e.g. mentions `` `bun` ``) → `citedPackages` stays empty (proves incidental prose mentions aren't miscaptured as citations).
- A fenced example *inside* the review section that itself contains a line starting with `##` → section extraction still reaches and captures a real `None identified` line or citation that appears after the fence (proves fence-stripping happens before, not after, the next-heading boundary search).
- A fenced block *earlier in the file* (e.g. a "Background" section quoting this rule's own text for reviewer context) that itself contains the literal heading `## Reusable capability review` and an example citation → the real section further down is still the one extracted, not the decoy (proves the whole source is fence-stripped before the heading search runs, not just the text after wherever it first matches). A file containing only the decoy and no real section → `hasSection: false`.
- An HTML comment (`<!-- ... -->`) earlier in the file containing a decoy heading and citation → the real section is still the one extracted (same proof as the fenced-decoy case, for the HTML-comment hiding vector), and a real section whose body legitimately contains a commented-out draft heading line doesn't get truncated early.
- A real, compliant section containing a 4-space-indented illustrative "what not to write" example with a citation-shaped line inside it → that indented line does not leak into `citedPackages`.
- Section present with neither a valid None-identified line nor any citation → `hasSection: true`, `noneIdentified: false`, `citedPackages: []` (the violation shape `main()` catches).
- Two different app proposals both citing the same unshipped package → (exercised at the `main()`/integration level, not `scanProposal`) each produces its own independent violation line.

The archive-lookup / violation-assembly layer (`main()`) is exercised end-to-end by running the gate for real against this repo's own `openspec/changes/` (exists, empty) and `openspec/archive/` (doesn't exist as a directory yet — `Glob.scan()` against a missing directory returns zero matches without throwing, the same assumption `check-verified-by.ts --mode=archive` already relies on), so the gate should report "OK 0 app proposals scanned" with zero violations, matching how the other now-empty-config gates degrade to a no-op on this fresh template.

## Non-goals

- No retroactive scan of existing apps (`apps/` is empty in this repo today — this is purely prospective).
- No automated judgment of *whether* something is genuinely reusable, or of whether a written "None identified" reason is a *good* reason — the reusability heuristic is documentation for a human/agent to apply, and the reason-check is syntactic presence only. The gate only checks that the review happened, that a real justification string exists either way, and that cited packages shipped first.
- No change to the `**Package**:` field's existing semantics or to `conformance.ts` — `**App**:` is a new, separate frontmatter field, and `findRelatedChangeFolders` is not modified or reused; the new script authors its own extraction regexes as specified in §2.
- No `--mode=archive` companion (unlike §20's gate) — this check is only ever meaningful pre-archival, and running inside `bun run lint` already covers that (see §1).
- **Known, accepted limitations** (found in round 5, deliberately not fixed — not chasing every markdown-hiding mechanism, per the review-round cap): `NONE_IDENTIFIED_RE`'s `[-—]` class doesn't include an en dash (`–`, U+2013) — a genuine en-dash (a common editor auto-substitution) would fail to register `noneIdentified: true` even with a real reason present, surfacing as a normal "section present but invalid" violation an author can fix by retyping the dash. And `stripCodeBlocks` doesn't specially handle a malformed/unclosed fence (a stray ` ``` ` with no matching close before EOF) — behavior in that case is unspecified/implementation-dependent rather than deliberately designed, since malformed markdown in a `proposal.md` is itself already a defect an author would need to fix regardless of this gate.
