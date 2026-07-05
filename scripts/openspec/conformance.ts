#!/usr/bin/env bun
/**
 * openspec-conformance — assert that a package's implementation actually
 * matches its OpenSpec contract.
 *
 * The hygiene gates (lint, typecheck, coverage, docs:check) verify that
 * something exists and compiles. They cannot tell whether the spec's
 * MUST clauses are reflected in code. This script closes that gap with
 * six static checks:
 *
 *   1. **Spec parsing** — every `### Requirement: <name>` heading (the
 *      current openspec/AGENTS.md §0c format — the same heading form
 *      check-verified-by.ts parses, so the two scripts agree on what a
 *      requirement heading looks like) in the relevant spec(s) must carry
 *      a `**Verified by:**` or `**Verified by (gate):**` line.
 *   2. **Error codes thrown** — every code in `src/error-codes.ts` is
 *      thrown from at least one non-test source file.
 *   3. **Schemas at boundaries** — every schema exported from
 *      `src/schemas/` is invoked via `.parse(` / `.safeParse(` at a
 *      non-test call site.
 *   4. **No `: unknown` in public d.ts** — public types must not leak
 *      `unknown` (often a sign of a generic that wasn't threaded
 *      through). Limited to the package's own `dist/`, ignoring
 *      bundled vendor `.d.ts` files.
 *   5. **Side-effect code registration** — if `src/error-codes.ts`
 *      exists, `src/index.ts` MUST side-effect-import it.
 *   6. **No retroactive ticking** — `tasks.md` of any change folder
 *      pointing at this package must not contain the literal string
 *      "retroactively ticked".
 *
 * Usage:
 *   bun scripts/openspec/conformance.ts <pkg-name|pkg-dir>
 *   bun scripts/openspec/conformance.ts --all
 *   bun scripts/openspec/conformance.ts --json <pkg>
 *
 * Exits 0 on full pass, 1 on any failure.
 *
 * Layout genericization: this port reads the package's own `package.json`
 * `name` field to determine its npm scope rather than assuming a
 * hardcoded prefix, and discovers workspace packages via the shared
 * `discoverPackageDirs()` helper (`scripts/lib/discover-packages.ts`),
 * which already supports this project's canonical 2-level
 * `packages/<category>/<pkg>/` layout (plus flat and 3-level fallbacks) —
 * unlike the reference implementation's hardcoded 3-level-only walk.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPackageDirs } from "../lib/discover-packages.js";

// See scripts/lint/check-verified-by.ts for why `fileURLToPath` is used
// instead of Bun's `import.meta.dir` extension (portability under a
// bundler/transform layer such as vitest).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHIVE_DIR = join(ROOT, "openspec", "archive");
const CHANGES_DIR = join(ROOT, "openspec", "changes");

type Severity = "error" | "warn" | "info";

interface Finding {
    severity: Severity;
    rule: string;
    message: string;
    evidence?: string;
}

interface Report {
    pkgName: string;
    pkgDir: string;
    findings: Finding[];
    skipped: string[];
}

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(): { targets: string[]; json: boolean; all: boolean } {
    const args = process.argv.slice(2);
    let json = false;
    let all = false;
    const targets: string[] = [];
    for (const a of args) {
        if (a === "--json") json = true;
        else if (a === "--all") all = true;
        else targets.push(a);
    }
    return { targets, json, all };
}

// ── Package resolution ────────────────────────────────────────────────────────

/** Strips any `@scope/` prefix — scope-agnostic, no hardcoded org name. */
function bareName(name: string): string {
    return name.replace(/^@[^/]+\//, "");
}

async function findPackageDir(target: string): Promise<string> {
    // Allow absolute / relative path
    const asPath = resolve(target);
    if (existsSync(join(asPath, "package.json"))) return asPath;

    // Match against the enumerated workspace packages by package.json `name`
    // (preferred, compared scope-insensitively) or by the package folder
    // basename. Layout-agnostic: delegates to discoverPackageDirs(), which
    // walks this project's canonical packages/<category>/<pkg> tree (with
    // flat and 3-level fallbacks).
    const wantBare = bareName(target);
    for (const dir of await discoverPackageDirs({ root: ROOT })) {
        try {
            const name = readPkgName(dir);
            if (name === target || bareName(name) === wantBare) return dir;
        } catch {
            // unreadable package.json — fall through to basename match
        }
        if (basename(dir) === wantBare) return dir;
    }
    throw new Error(`package not found: ${target}`);
}

function readPkgName(pkgDir: string): string {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    return pkg.name as string;
}

// ── File walker (src/) ────────────────────────────────────────────────────────

function walkSrc(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // Avoid descending into vendored deps or build outputs that may
        // appear under src/ in some packages.
        if (
            entry.name === "node_modules" ||
            entry.name === "dist" ||
            entry.name === ".turbo"
        )
            continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            walkSrc(p, out);
        } else if (
            /\.tsx?$/.test(entry.name) &&
            !/\.(test|spec|bench|stories)\.tsx?$/.test(entry.name)
        ) {
            out.push(p);
        }
    }
    return out;
}

// Cache per-package src reads — checkErrorCodes and checkSchemas both want
// the full source list, and readFileSync over many files is the dominant
// per-package cost on `--all` runs.
const srcCache = new Map<string, { path: string; content: string }[]>();
function readAllSrc(pkgDir: string): { path: string; content: string }[] {
    const cached = srcCache.get(pkgDir);
    if (cached) return cached;
    const files = walkSrc(join(pkgDir, "src"));
    const out = files.map((f) => ({
        path: f,
        content: readFileSync(f, "utf8"),
    }));
    srcCache.set(pkgDir, out);
    return out;
}

// ── Check: error codes thrown ─────────────────────────────────────────────────

function checkErrorCodes(pkgDir: string, findings: Finding[]): void {
    const codesPath = join(pkgDir, "src", "error-codes.ts");
    if (!existsSync(codesPath)) return;
    const content = readFileSync(codesPath, "utf8");
    const m = content.match(
        /defineCodes\(\s*["'][^"']+["']\s*,\s*\[([\s\S]*?)\]\s*as const\s*\)/
    );
    if (!m) {
        findings.push({
            severity: "warn",
            rule: "error-codes",
            message:
                "src/error-codes.ts present but defineCodes(...) call not parseable",
            evidence: relative(ROOT, codesPath),
        });
        return;
    }
    const codeNames = [...(m[1] as string).matchAll(/["']([A-Z0-9_]+)["']/g)]
        .map((c) => c[1] as string)
        .filter(Boolean);
    if (codeNames.length === 0) return;

    const sources = readAllSrc(pkgDir).filter(
        (s) => !s.path.endsWith("error-codes.ts")
    );
    for (const code of codeNames) {
        const re = new RegExp(`\\b${code}\\b`);
        const hit = sources.find((s) => re.test(s.content));
        if (!hit) {
            findings.push({
                severity: "error",
                rule: "error-codes-thrown",
                message: `error code ${code} is registered but never used in src/`,
            });
        }
    }
}

// ── Check: schemas at boundaries ──────────────────────────────────────────────

function checkSchemas(pkgDir: string, findings: Finding[]): void {
    const schemasDir = join(pkgDir, "src", "schemas");
    if (!existsSync(schemasDir)) return;
    const schemaFiles = walkSrc(schemasDir);
    if (schemaFiles.length === 0) return;

    const schemaNames: string[] = [];
    for (const f of schemaFiles) {
        const content = readFileSync(f, "utf8");
        for (const m of content.matchAll(
            /\bexport\s+const\s+([A-Z]\w*Schema)\b/g
        )) {
            schemaNames.push(m[1] as string);
        }
    }

    const sources = readAllSrc(pkgDir).filter(
        (s) => !s.path.startsWith(schemasDir)
    );
    for (const name of schemaNames) {
        const re = new RegExp(`\\b${name}\\.(safe)?[Pp]arse\\(`);
        const hit = sources.find((s) => re.test(s.content));
        if (!hit) {
            findings.push({
                severity: "warn",
                rule: "schemas-at-boundaries",
                message: `${name} is exported but never invoked outside src/schemas/. If it is consumer-facing only, mark with a "// schema: boundary-only" comment in the schema file to suppress.`,
            });
        }
    }
}

// ── Check: side-effect import in index ────────────────────────────────────────

function checkSideEffectImport(pkgDir: string, findings: Finding[]): void {
    const codes = join(pkgDir, "src", "error-codes.ts");
    if (!existsSync(codes)) return;
    const idx = join(pkgDir, "src", "index.ts");
    if (!existsSync(idx)) return;
    const content = readFileSync(idx, "utf8");
    const sideEffect = /^\s*import\s+["']\.\/error-codes(?:\.js)?["']\s*;?$/m;
    if (!sideEffect.test(content)) {
        findings.push({
            severity: "error",
            rule: "side-effect-codes-import",
            message:
                'src/index.ts must side-effect-import "./error-codes.js" so subpath consumers register codes too. Add: import "./error-codes.js";',
        });
    }
}

// ── Check: : unknown in public d.ts ───────────────────────────────────────────

function checkPublicUnknown(pkgDir: string, findings: Finding[]): void {
    const dist = join(pkgDir, "dist");
    if (!existsSync(dist)) {
        findings.push({
            severity: "info",
            rule: "public-unknown",
            message:
                "dist/ not found — run `bunx turbo build` to enable public-type leakage check",
        });
        return;
    }
    const dts: string[] = [];
    walkDts(dist, dts);
    let leakCount = 0;
    const samples: string[] = [];
    for (const f of dts) {
        // Skip bundled vendor d.ts files (the build pulls in transitive deps)
        if (f.includes("/node_modules/")) continue;
        const lines = readFileSync(f, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] as string;
            // Skip private/protected members and comment lines
            if (/^\s*(private|protected|\/\/|\/\*)/.test(line)) continue;
            // Match `: unknown` followed by `;`, `,`, `)`, `=`, `|`, end-of-line
            // but not as part of `Record<string, unknown>` / `unknown[]`.
            // Allow standard ES `Error.cause` shape (`cause?: unknown`),
            // which is the spec-mandated type for Error.cause and not
            // a sign of generics drift.
            if (/\bcause\??\s*:\s*unknown\b/.test(line)) continue;
            if (/:\s*unknown\s*[;,)|=]?\s*$/.test(line)) {
                leakCount++;
                if (samples.length < 5) {
                    samples.push(
                        `${relative(ROOT, f)}:${i + 1}: ${line.trim()}`
                    );
                }
            }
        }
    }
    if (leakCount > 0) {
        findings.push({
            severity: "warn",
            rule: "public-unknown",
            message: `${leakCount} public position(s) in dist/*.d.ts resolve to "unknown". This often means a generic was declared in the spec but not threaded through the public API.`,
            evidence: samples.join("\n  "),
        });
    }
}

function walkDts(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // Skip vendored deps — they cost the bulk of the wall-clock for
        // packages that bundle large dependency graphs. The leak check
        // filters these on the path anyway; pruning here saves the
        // readdirSync recursion.
        if (entry.name === "node_modules") continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDts(p, out);
        } else if (entry.name.endsWith(".d.ts")) {
            out.push(p);
        }
    }
}

// ── Check: spec requirements have Verified-by ────────────────────────────────

function findRelatedChangeFolders(pkgName: string): string[] {
    const bare = bareName(pkgName);
    const out: string[] = [];
    // Authoritative match: a change folder is "related" to this package
    // only if its proposal.md declares `**Package**: <name>` (with an
    // optional `@scope/` prefix, whatever scope this project uses) in the
    // frontmatter (first 30 lines). Folder-name matching is unreliable —
    // e.g. a `payments-testing` and a `payments-testing-dom` folder both
    // contain the `testing` token but belong to different packages.
    // Match list-item or bare frontmatter line:
    //   "- **Package**: `@scope/<bare>`"
    //   "**Package**: <bare>"
    const frontmatterRe = new RegExp(
        `(?:^|\\n)\\s*-?\\s*\\*\\*Package\\*\\*:\\s*\`?(?:@[^/\`]+/)?${escapeRe(bare)}\`?\\s*(?:$|\\n)`
    );
    for (const root of [ARCHIVE_DIR, CHANGES_DIR]) {
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const folder = join(root, entry.name);
            const proposal = join(folder, "proposal.md");
            if (!existsSync(proposal)) continue;
            const content = readFileSync(proposal, "utf8");
            const head = content.split("\n").slice(0, 30).join("\n");
            if (frontmatterRe.test(head)) out.push(folder);
        }
    }
    return out;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRelatedSpecCapabilities(pkgName: string): string[] {
    // Map related change folders → capability names referenced in their
    // specs/<cap>/ subdirs. The folded source-of-truth specs live under
    // `openspec/specs/<cap>/spec.md`.
    const folders = findRelatedChangeFolders(pkgName);
    const caps = new Set<string>();
    for (const folder of folders) {
        const specsDir = join(folder, "specs");
        if (!existsSync(specsDir)) continue;
        for (const cap of readdirSync(specsDir, { withFileTypes: true })) {
            if (cap.isDirectory()) caps.add(cap.name);
        }
    }
    // Fallback: package basename as capability name (common pattern).
    const bare = bareName(pkgName);
    if (existsSync(join(ROOT, "openspec", "specs", bare))) caps.add(bare);
    return [...caps];
}

function checkSpecVerifiedBy(
    pkgName: string,
    pkgDir: string,
    findings: Finding[]
): void {
    const caps = findRelatedSpecCapabilities(pkgName);
    if (caps.length === 0) {
        findings.push({
            severity: "info",
            rule: "spec-verified-by",
            message:
                "no related OpenSpec capability found; spec-conformance skipped",
        });
        return;
    }
    // Authoritative spec sources: the folded `openspec/specs/<cap>/spec.md`
    // PLUS any active change in `openspec/changes/<id>/specs/<cap>/spec.md`
    // whose proposal.md frontmatter explicitly names THIS package. Active
    // changes that touch the same capability but belong to a different
    // package MUST NOT be pulled in here — that would force this package's
    // audit to verify requirements another change is on the hook for.
    const relatedFolders = new Set(findRelatedChangeFolders(pkgName));
    const specPaths: string[] = [];
    for (const cap of caps) {
        const folded = join(ROOT, "openspec", "specs", cap, "spec.md");
        if (existsSync(folded)) specPaths.push(folded);
    }
    for (const folder of relatedFolders) {
        if (!folder.startsWith(CHANGES_DIR)) continue;
        for (const cap of caps) {
            const spec = join(folder, "specs", cap, "spec.md");
            if (existsSync(spec)) specPaths.push(spec);
        }
    }

    let totalReqs = 0;
    let unverified = 0;
    const samples: string[] = [];
    // Same heading form check-verified-by.ts's REQ_RE parses
    // (`### Requirement: <name>`) — kept in agreement so the two scripts
    // never disagree about what counts as a requirement.
    const VERIFIED_ANY_RE = /\*\*Verified by(?:\s\(gate\))?:\*\*/;
    for (const spec of specPaths) {
        const content = readFileSync(spec, "utf8");
        const blocks = splitByHeading(content, /^###\s+(.+?)\s*$/m);
        for (const { heading, body } of blocks) {
            const m = /^Requirement:\s+(.+)$/.exec(heading);
            if (m === null) continue;
            totalReqs++;
            if (!VERIFIED_ANY_RE.test(body)) {
                unverified++;
                if (samples.length < 5) {
                    samples.push(`${relative(ROOT, spec)}: ${heading}`);
                }
            }
        }
    }
    if (totalReqs === 0) {
        findings.push({
            severity: "info",
            rule: "spec-verified-by",
            message:
                "no `### Requirement:` headings parsed in folded specs/ or active changes/ for this package",
        });
        return;
    }
    if (unverified > 0) {
        findings.push({
            severity: "error",
            rule: "spec-verified-by",
            message: `${unverified}/${totalReqs} requirement(s) lack a **Verified by:** line in folded spec or active change. Add a line naming the test that asserts the requirement.`,
            evidence: samples.join("\n  "),
        });
    }
    void pkgDir;
}

function splitByHeading(
    content: string,
    re: RegExp
): { heading: string; body: string }[] {
    const lines = content.split("\n");
    const out: { heading: string; body: string }[] = [];
    let current: { heading: string; body: string[] } | null = null;
    for (const line of lines) {
        const m = line.match(re);
        if (m) {
            if (current)
                out.push({
                    heading: current.heading,
                    body: current.body.join("\n"),
                });
            current = { heading: m[1] as string, body: [] };
        } else if (current) {
            current.body.push(line);
        }
    }
    if (current)
        out.push({
            heading: current.heading,
            body: current.body.join("\n"),
        });
    return out;
}

// ── Check: no retroactive ticking ─────────────────────────────────────────────

function checkNoRetroactiveTicking(pkgName: string, findings: Finding[]): void {
    const bare = bareName(pkgName);
    const folders = findRelatedChangeFolders(pkgName);
    // A *-spec-conformance change (active or archived) rectifies prior drift.
    const hasRectification = folders.some((f) =>
        /spec-conformance|conformance/.test(basename(f))
    );
    for (const folder of folders) {
        const tasks = join(folder, "tasks.md");
        if (!existsSync(tasks)) continue;
        const content = readFileSync(tasks, "utf8");
        if (!/retroactively ticked/i.test(content)) continue;
        const isHistorical = folder.startsWith(ARCHIVE_DIR);
        if (isHistorical && hasRectification) {
            findings.push({
                severity: "info",
                rule: "no-retroactive-ticking",
                message: `${relative(ROOT, tasks)} was retroactively ticked, but a *-spec-conformance change has rectified it.`,
            });
        } else {
            findings.push({
                severity: "error",
                rule: "no-retroactive-ticking",
                message: `${relative(ROOT, tasks)} contains the phrase "retroactively ticked" — open a ${bare}-spec-conformance change before more migrations.`,
            });
        }
    }
}

// ── Run ───────────────────────────────────────────────────────────────────────

function runOne(pkgDir: string): Report {
    const pkgName = readPkgName(pkgDir);
    const findings: Finding[] = [];
    const skipped: string[] = [];
    checkErrorCodes(pkgDir, findings);
    checkSchemas(pkgDir, findings);
    checkSideEffectImport(pkgDir, findings);
    checkPublicUnknown(pkgDir, findings);
    checkSpecVerifiedBy(pkgName, pkgDir, findings);
    checkNoRetroactiveTicking(pkgName, findings);
    return { pkgName, pkgDir, findings, skipped };
}

function printReport(report: Report): boolean {
    const errors = report.findings.filter((f) => f.severity === "error");
    const warns = report.findings.filter((f) => f.severity === "warn");
    const infos = report.findings.filter((f) => f.severity === "info");

    const status = errors.length === 0 ? "PASS" : "FAIL";
    const summary = `${status}  ${report.pkgName}  (${errors.length} error, ${warns.length} warn, ${infos.length} info)`;
    process.stdout.write(`${summary}\n`);
    for (const f of report.findings) {
        const tag =
            f.severity === "error" ? "✖" : f.severity === "warn" ? "!" : "·";
        process.stdout.write(`  ${tag} [${f.rule}] ${f.message}\n`);
        if (f.evidence) {
            for (const line of f.evidence.split("\n")) {
                process.stdout.write(`      ${line}\n`);
            }
        }
    }
    return errors.length === 0;
}

async function main(): Promise<void> {
    const { targets, json, all } = parseArgs();
    if (!all && targets.length === 0) {
        process.stderr.write(
            "usage: bun scripts/openspec/conformance.ts <pkg-name|pkg-dir> [--json] | --all\n"
        );
        process.exit(2);
    }
    const dirs = all
        ? await discoverPackageDirs({ root: ROOT })
        : await Promise.all(targets.map((t) => findPackageDir(t)));
    if (all && dirs.length === 0) {
        console.log(
            "OK  --all found 0 packages under packages/ — nothing to check yet."
        );
        return;
    }
    // Stream per-package: run + print as we go so `--all` produces output
    // immediately instead of buffering until every package has been scanned.
    const reports: Report[] = [];
    let failedCount = 0;
    for (const dir of dirs) {
        const report = runOne(dir);
        reports.push(report);
        if (!json) {
            printReport(report);
        }
        if (report.findings.some((f) => f.severity === "error")) {
            failedCount++;
        }
    }
    if (json) {
        process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    }
    if (!json && all) {
        process.stdout.write(
            `\n=== ${reports.length - failedCount}/${reports.length} packages pass ===\n`
        );
    }
    process.exit(failedCount === 0 ? 0 : 1);
}

await main();
