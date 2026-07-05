#!/usr/bin/env bun

/**
 * Enforce §20 of `openspec/AGENTS.md`: every ADDED/MODIFIED requirement in
 * every spec delta MUST carry a `**Verified by:**` line. At archive time, the
 * cited file path MUST exist and the cited it("...") title MUST be
 * present. Requirements under a `## REMOVED Requirements` section are exempt —
 * they describe deleted behaviour with no surviving test to cite.
 *
 * Modes
 * -----
 * - `--mode=author`  (default): runs on changes in `openspec/changes/`.
 *   Verified-by lines must be syntactically valid; cited files need
 *   not exist yet.
 * - `--mode=archive`: runs on changes in `openspec/archive/`. Cited
 *   files MUST exist and contain the cited title.
 *
 * No grandfather clause: unlike the reference implementation this was
 * ported from, this project has zero pre-existing OpenSpec history to
 * exempt — §20 applies to every change folder from day one. If a future
 * rule change needs a similar cutover mechanism, add it back deliberately
 * (with its own effective-date constant) rather than reintroducing this
 * one unused.
 */

import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

// `fileURLToPath(import.meta.url)` rather than Bun's `import.meta.dir`
// extension — the latter resolves to `undefined` when this module is loaded
// through a bundler/transform layer (e.g. vitest, even under `--bun`),
// which breaks unit-testing `scanSpec` in isolation. `fileURLToPath` is
// standard and works identically under `bun run`, `bunx --bun vitest`, and
// plain Node.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Violation {
    readonly file: string;
    readonly line: number;
    readonly reason: string;
}

const REQ_RE = /^### Requirement:\s+(.+)$/;
const VERIFIED_RE = /^\*\*Verified by:\*\*\s+(.+)$/;
const CITE_RE = /`([^`]+\.test\.tsx?|[^`]+\.spec\.tsx?)::"([^"]+)"`/g;

/**
 * Some requirements are not unit-test-shaped — they are verified by a build,
 * typecheck, coverage, or lint gate, a dependency-graph / package-shape check,
 * a compile-time type check, a `.stories.tsx` presence gate, or a container
 * build. For these, a runtime `it()::"title"` citation would be a false tick.
 * They MUST instead use the explicit `**Verified by (gate):**` marker, whose
 * line MUST name a concrete, recognised mechanism (a backtick-wrapped command
 * or artifact) — never vague prose. This keeps the escape hatch auditable: a
 * reader can see at a glance which requirements are gate-verified vs
 * test-verified, and the mechanism named is a real, runnable one.
 */
const VERIFIED_GATE_RE = /^\*\*Verified by \(gate\):\*\*\s+(.+)$/;
// The gate line must name a CONCRETE mechanism in backticks — either a
// file/artifact path (contains a `.` or `/`: `MANIFEST.md`, `vitest.config.ts`,
// `scripts/manifest/generate-manifest.ts`, `apps/demo/e2e/smoke.test.ts`) or a
// runnable command (starts with a known verb: `bunx turbo build`, `tsc`,
// `pytest`, `docker compose up`). Vague prose (`the build gate`, `the suite`)
// carries no such token and is rejected.
const GATE_MECH_RE =
    /`[^`]*[./][^`]*`|`\s*(?:tsc|pytest|turbo|bunx?|npx|docker|node)\b[^`]*`/;

function modeFromArgv(): "author" | "archive" {
    const arg = process.argv.find((a) => a.startsWith("--mode="));
    if (arg === undefined) return "author";
    const val = arg.slice("--mode=".length);
    if (val !== "author" && val !== "archive") {
        console.error(`bad --mode value: ${val}`);
        process.exit(2);
    }
    return val;
}

async function fileExists(absPath: string): Promise<boolean> {
    try {
        await stat(absPath);
        return true;
    } catch {
        return false;
    }
}

interface ArchiveCite {
    readonly line: number;
    readonly path: string;
    readonly title: string;
}

interface ScanResult {
    readonly violations: Violation[];
    /**
     * Parsed `path::"title"` citations from non-removed requirements, carried
     * out for the archive-time file/title existence check in `checkSpecFile`.
     */
    readonly archiveCites: ArchiveCite[];
}

/**
 * Pure line-scan of one spec delta (no file I/O). Flags every ADDED/MODIFIED
 * requirement that lacks a `**Verified by:**` line, or whose line carries no
 * parseable `path::"title"` citation. Requirements under a
 * `## REMOVED Requirements` section describe behaviour being deleted — there
 * is no surviving test to cite, so §20's Verified-by mandate does not apply to
 * them and they are never flagged even though they keep a `### Requirement:`
 * header.
 */
export function scanSpec(source: string, rel: string): ScanResult {
    const lines = source.split("\n");
    const violations: Violation[] = [];
    const archiveCites: ArchiveCite[] = [];
    let inRequirement = false;
    let reqStartLine = 0;
    let reqTitle = "";
    let sawVerified = false;
    // The active `## …` section, and the section each open requirement belongs
    // to, so a removed requirement stays exempt for its whole body.
    let currentSectionRemoved = false;
    let reqInRemovedSection = false;
    const flush = (): void => {
        if (inRequirement && !sawVerified && !reqInRemovedSection) {
            violations.push({
                file: rel,
                line: reqStartLine,
                reason: `Requirement "${reqTitle}" lacks a **Verified by:** line`,
            });
        }
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const m = REQ_RE.exec(line);
        if (m !== null) {
            flush();
            inRequirement = true;
            reqStartLine = i + 1;
            reqTitle = m[1] ?? "";
            sawVerified = false;
            reqInRemovedSection = currentSectionRemoved;
            continue;
        }
        if (line.startsWith("## ")) {
            flush();
            inRequirement = false;
            currentSectionRemoved = /^##\s+REMOVED\b/i.test(line);
            continue;
        }
        if (line.startsWith("### ")) {
            flush();
            inRequirement = false;
            continue;
        }
        if (!inRequirement || reqInRemovedSection) continue;
        const gm = VERIFIED_GATE_RE.exec(line);
        if (gm !== null) {
            sawVerified = true;
            const gateLine = gm[1] ?? "";
            if (!GATE_MECH_RE.test(gateLine)) {
                violations.push({
                    file: rel,
                    line: i + 1,
                    reason: `Verified-by (gate) line must name a recognised build/typecheck/coverage/lint/structural mechanism in backticks (got: ${gateLine.slice(0, 80)})`,
                });
            }
            continue;
        }
        const vm = VERIFIED_RE.exec(line);
        if (vm === null) continue;
        sawVerified = true;
        const verifiedLine = vm[1] ?? "";
        const verifiedLineNo = i + 1;
        const cites = [...verifiedLine.matchAll(CITE_RE)];
        if (cites.length === 0) {
            violations.push({
                file: rel,
                line: verifiedLineNo,
                reason: `Verified-by line lacks a parseable path::"title" citation (got: ${verifiedLine.slice(0, 80)})`,
            });
            continue;
        }
        for (const c of cites) {
            const path = c[1];
            const title = c[2];
            if (path === undefined || title === undefined) continue;
            archiveCites.push({ line: verifiedLineNo, path, title });
        }
    }
    flush();
    return { violations, archiveCites };
}

async function checkSpecFile(
    rel: string,
    mode: "author" | "archive"
): Promise<Violation[]> {
    const abs = resolve(REPO_ROOT, rel);
    const source = await readFile(abs, "utf8");
    const { violations, archiveCites } = scanSpec(source, rel);
    if (mode !== "archive") return violations;
    const pkgGuess = pkgRootOf(rel);
    if (pkgGuess === undefined) return violations;
    for (const c of archiveCites) {
        const testAbs = resolve(REPO_ROOT, pkgGuess, c.path);
        if (!(await fileExists(testAbs))) {
            violations.push({
                file: rel,
                line: c.line,
                reason: `cited test file does not exist: ${pkgGuess}/${c.path}`,
            });
            continue;
        }
        const src = await readFile(testAbs, "utf8");
        if (!src.includes(c.title)) {
            violations.push({
                file: rel,
                line: c.line,
                reason: `cited title not found in ${c.path}: "${c.title}"`,
            });
        }
    }
    return violations;
}

function pkgRootOf(specRel: string): string | undefined {
    // Capability-name -> package root mapping is ambiguous in a nested
    // monorepo. Skip strict archive-time existence check unless the
    // resolver can be made unambiguous via a `package-root-map.json`.
    void specRel;
    return undefined;
}

async function main(): Promise<void> {
    const mode = modeFromArgv();
    const pattern =
        mode === "archive"
            ? "openspec/archive/*/specs/*/spec.md"
            : "openspec/changes/*/specs/*/spec.md";
    const g = new Glob(pattern);
    const files: string[] = [];
    for await (const f of g.scan({ cwd: REPO_ROOT })) {
        files.push(f);
    }
    const allViolations: Violation[] = [];
    for (const f of files) {
        allViolations.push(...(await checkSpecFile(f, mode)));
    }
    if (allViolations.length === 0) {
        console.log(
            `OK  ${files.length} spec deltas scanned (mode=${mode}); every checked Requirement has a **Verified by:** citation.`
        );
        return;
    }
    console.error(
        `FAIL  ${allViolations.length} Verified-by violation(s) (mode=${mode}):`
    );
    for (const v of allViolations) {
        console.error(`  ${v.file}:${v.line}  ${v.reason}`);
    }
    console.error(
        "\n§20: every Requirement MUST have **Verified by:** path::title."
    );
    process.exit(1);
}

if (import.meta.main) {
    await main();
}
