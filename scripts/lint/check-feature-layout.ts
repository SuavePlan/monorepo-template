#!/usr/bin/env bun
/**
 * Feature-layout checker — recursive + ratcheted.
 *
 * RULE (openspec/AGENTS.md §3a "Feature-folder layout — one folder per code
 * file (NON-NEGOTIABLE)" / CLAUDE.md §6.1 "Directory structure"):
 *   Every implementation file MUST live inside its own eponymous feature
 *   folder. Concretely, for any `<name>.ts` / `<name>.tsx` under a
 *   package's `src/`, the basename of its PARENT directory MUST equal
 *   `<name>`:
 *
 *     src/<feature>/<feature>.ts        ✔  parent "<feature>" === "<feature>"
 *     src/<feature>.ts                  ✘  parent "src"       !== "<feature>"
 *     src/group/helper.ts               ✘  parent "group"     !== "helper"
 *
 *   This generalizes the original rule — which only flagged a flat
 *   `<feature>.ts` + `<feature>.test.ts` PAIR at `src/` root — to ALL
 *   depths. A flat impl at `src/` root has parent basename `src`, so it is
 *   flagged whether or not a sibling test exists; the original behaviour is
 *   preserved as the depth-0 case of the recursive walk.
 *
 * EXEMPT (never flagged):
 *   - exact names: `index.ts` (package / feature barrel), `error-codes.ts`
 *   - suffix kinds (thin single-concept modules, not feature impls):
 *       `*.types.ts(x)`, `*.test.ts(x)`, `*.spec.ts(x)`, `*.bench.ts(x)`,
 *       `*.data.ts`, `*.schemas.ts`, `*.stories.tsx`
 *   - anything inside a `types/`, `utils/`, `constants/`, `__benchmarks__/`,
 *     `__fixtures__/`, or `__mocks__/` directory (at any depth)
 *   - `dist/`, `coverage/`, `node_modules/`, `.turbo/` are skipped entirely
 *
 * RATCHET:
 *   Known pre-existing violations are recorded in
 *   `scripts/lint/feature-layout-baseline.json`. A normal run FAILS (exit 1)
 *   only on violations NOT present in the baseline. Baselined violations
 *   print as grandfathered warnings so they stay visible without blocking
 *   CI, and any baseline entry that is now clean is reported so the
 *   baseline can be pruned. New / migrated code is expected to be clean
 *   (not added to the baseline). This project starts with a fresh, empty
 *   baseline — nothing is grandfathered from day one.
 *
 *   `--update-baseline` rewrites the baseline from the current violation
 *   set (sorted, deterministic). Run it deliberately to grandfather a known
 *   batch or to drop entries that have since been fixed.
 *   `--show-grandfathered` expands the full baselined list (otherwise only
 *   the count is printed).
 *
 * Package discovery uses the shared `discoverPackageDirs()` helper
 * (`scripts/lib/discover-packages.ts`), which walks the canonical
 * `packages/<category>/<pkg>/` 2-level layout (with flat and 3-level
 * fallbacks).
 *
 * Exit codes: 0 = no NEW violations, 1 = at least one new violation.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPackageDirs } from "../lib/discover-packages.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const BASELINE_PATH = join(here, "feature-layout-baseline.json");

const SKIP_DIRS = new Set(["dist", "coverage", "node_modules", ".turbo"]);
const EXEMPT_ANCESTOR_DIRS = new Set([
    "types",
    "utils",
    "constants",
    "__benchmarks__",
    "__fixtures__",
    "__mocks__",
]);
const EXEMPT_EXACT = new Set(["index.ts", "error-codes.ts"]);

/** A filename that is a thin single-concept module, never a feature impl. */
function isExemptName(file: string): boolean {
    if (EXEMPT_EXACT.has(file)) return true;
    if (/\.(test|spec|bench)\.(ts|tsx)$/.test(file)) return true;
    if (/\.types\.(ts|tsx)$/.test(file)) return true;
    if (/\.(data|schemas)\.ts$/.test(file)) return true;
    if (/\.stories\.tsx$/.test(file)) return true;
    return false;
}

/** Repo-relative, posix-separated path for stable, cross-platform identity. */
function rel(full: string): string {
    return relative(repoRoot, full).split(sep).join("/");
}

/** Every discovered package's `src` directory that is present on disk. */
async function listPackageSrcDirs(): Promise<string[]> {
    const pkgDirs = await discoverPackageDirs({ root: repoRoot });
    const out: string[] = [];
    for (const pkgDir of pkgDirs) {
        const srcDir = join(pkgDir, "src");
        try {
            if (statSync(srcDir).isDirectory()) out.push(srcDir);
        } catch {
            // no src/ — skip
        }
    }
    return out;
}

function walk(dir: string, exemptAncestor: boolean, out: string[]): void {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        const full = join(dir, name);
        let isDir: boolean;
        try {
            isDir = statSync(full).isDirectory();
        } catch {
            continue;
        }
        if (isDir) {
            if (SKIP_DIRS.has(name)) continue;
            walk(full, exemptAncestor || EXEMPT_ANCESTOR_DIRS.has(name), out);
            continue;
        }
        if (exemptAncestor) continue;
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (isExemptName(name)) continue;
        const feature = name.replace(/\.(ts|tsx)$/, "");
        if (basename(dir) !== feature) out.push(rel(full));
    }
}

/** Sorted, de-duplicated list of every current layout violation, repo-wide. */
async function collectViolations(): Promise<string[]> {
    const out: string[] = [];
    for (const srcDir of await listPackageSrcDirs()) walk(srcDir, false, out);
    return [...new Set(out)].sort();
}

function loadBaseline(): Set<string> {
    try {
        const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as
            | string[]
            | { violations?: string[] };
        const arr = Array.isArray(parsed) ? parsed : (parsed.violations ?? []);
        return new Set(arr);
    } catch {
        return new Set();
    }
}

function writeBaseline(violations: string[]): void {
    const payload = {
        description:
            "Grandfathered feature-layout violations: impl files not yet in " +
            "their own eponymous folder. Generated by " +
            "scripts/lint/check-feature-layout.ts --update-baseline. New code " +
            "must NOT be added here — move it into src/.../<name>/<name>.ts.",
        violations: [...violations].sort(),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 4)}\n`);
}

function featureFolderHint(violationPath: string): string {
    return basename(violationPath).replace(/\.(ts|tsx)$/, "");
}

async function main(): Promise<void> {
    const current = await collectViolations();

    if (process.argv.includes("--update-baseline")) {
        writeBaseline(current);
        console.log(
            `Baseline updated: ${current.length} grandfathered violation(s) written to ${rel(BASELINE_PATH)}.`
        );
        return;
    }

    const baseline = loadBaseline();
    const currentSet = new Set(current);
    const newViolations = current.filter((v) => !baseline.has(v));
    const grandfathered = current.filter((v) => baseline.has(v));
    const staleBaseline = [...baseline]
        .filter((v) => !currentSet.has(v))
        .sort();
    const showGrandfathered =
        process.argv.includes("--show-grandfathered") ||
        newViolations.length > 0;

    if (grandfathered.length > 0) {
        console.warn(
            `${grandfathered.length} grandfathered layout violation(s) (in baseline, not failing)${showGrandfathered ? ":" : " — pass --show-grandfathered to list."}`
        );
        if (showGrandfathered) {
            for (const v of grandfathered) console.warn(`  - ${v}`);
        }
    }
    if (staleBaseline.length > 0) {
        console.warn(
            `\n${staleBaseline.length} baseline entr${staleBaseline.length === 1 ? "y is" : "ies are"} now clean — run --update-baseline to prune:`
        );
        for (const v of staleBaseline) console.warn(`  - ${v}`);
    }

    if (newViolations.length === 0) {
        console.log(
            `\nOK: no new feature-layout violations (${grandfathered.length} grandfathered).`
        );
        return;
    }

    console.error(
        `\nFound ${newViolations.length} NEW feature-layout violation${newViolations.length === 1 ? "" : "s"}:\n`
    );
    for (const v of newViolations) {
        console.error(`FAIL ${v}`);
        console.error(
            `     impl must live in its own folder: ${dirname(v)}/${featureFolderHint(v)}/${basename(v)}`
        );
    }
    console.error(
        "\nopenspec/AGENTS.md §3a mandates one folder per code file. Move " +
            "each impl into src/.../<name>/<name>.ts with a sibling <name>.md and an " +
            "index.ts barrel (explicit named re-exports). If a violation is " +
            "intentional and pre-existing, run with --update-baseline to grandfather it."
    );
    process.exit(1);
}

await main();
