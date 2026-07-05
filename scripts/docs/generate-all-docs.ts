#!/usr/bin/env bun

/**
 * generate-all-docs — run the documentation-tree generators in dependency
 * order, bottom-up, with one command instead of five.
 *
 * Each layer reads the artifacts the previous layers produced, so the order
 * matters:
 *
 *   1. ensure-category-intros       — seed any missing `_intro.md`
 *      placeholders so the index generators have a header to fold in.
 *   2. generate-package-module-tree — inject the per-package
 *      "Documentation tree" section into every package README + module `.md`.
 *   3. generate-category-readmes    — `packages/<cat>/README.md`
 *   4. generate-packages-root-readme — `packages/README.md`
 *   5. generate-root-readme         — `<repo>/README.md`
 *
 * This template's layout is 2-level (`packages/<category>/<pkg>/`), so there
 * is no subcategory-README step between (2) and (3) the way genesis's
 * 3-level layout needs one.
 *
 * Usage:
 *   bun scripts/docs/generate-all-docs.ts            # rewrite the whole tree
 *   bun scripts/docs/generate-all-docs.ts --check    # exit 1 on any drift
 *   bun scripts/docs/generate-all-docs.ts --verbose  # extra per-step output
 *
 * `--check` forwards `--check` to every generator that supports it and skips
 * the intro-seeding step (which only ever writes). In check mode the run is
 * NOT fail-fast: every layer is checked so a single run reports all drift,
 * then the process exits non-zero if any layer drifted. Without `--check`
 * the run is fail-fast — a non-zero exit is a genuine generator error.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CONFIG } from "../lib/config.js";

const ROOT = CONFIG.paths.root;
const DOCS_SCRIPTS_DIR = join(ROOT, "scripts", "docs");

interface Step {
    readonly script: string;
    readonly label: string;
    /** Forward `--check` to this generator. */
    readonly supportsCheck: boolean;
    /** Forward `--verbose` to this generator. */
    readonly supportsVerbose: boolean;
    /** Run this step in `--check` mode (intro-seeding is write-only). */
    readonly runInCheck: boolean;
    /**
     * Re-run this writer until a follow-up `--check` is clean (bounded). The
     * module-tree generator embeds each child `.md`'s first-paragraph summary
     * into its parent's tree in a single pass, so a description that changes
     * mid-pass needs a second pass to propagate to parents already rendered.
     */
    readonly convergeInWrite: boolean;
}

/** Hard cap on convergence re-runs for a single writer step. */
const MAX_CONVERGENCE_PASSES = 5;

const STEPS: readonly Step[] = [
    {
        script: "ensure-category-intros.ts",
        label: "Seed missing _intro.md placeholders",
        supportsCheck: false,
        supportsVerbose: false,
        runInCheck: false,
        convergeInWrite: false,
    },
    {
        script: "generate-package-module-tree.ts",
        label: "Package documentation trees",
        supportsCheck: true,
        supportsVerbose: true,
        runInCheck: true,
        convergeInWrite: true,
    },
    {
        script: "generate-category-readmes.ts",
        label: "Category READMEs",
        supportsCheck: true,
        supportsVerbose: false,
        runInCheck: true,
        convergeInWrite: false,
    },
    {
        script: "generate-packages-root-readme.ts",
        label: "packages/README.md",
        supportsCheck: true,
        supportsVerbose: false,
        runInCheck: true,
        convergeInWrite: false,
    },
    {
        script: "generate-root-readme.ts",
        label: "Root README.md",
        supportsCheck: true,
        supportsVerbose: false,
        runInCheck: true,
        convergeInWrite: false,
    },
];

interface CliOptions {
    readonly check: boolean;
    readonly verbose: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
    let check = false;
    let verbose = false;
    for (const arg of argv) {
        if (arg === "--check") check = true;
        else if (arg === "--verbose") verbose = true;
        else {
            console.error(`Unknown flag: ${arg}`);
            console.error(
                "Usage: bun scripts/docs/generate-all-docs.ts [--check] [--verbose]"
            );
            process.exit(1);
        }
    }
    return { check, verbose };
}

interface SpawnFlags {
    readonly check: boolean;
    readonly verbose: boolean;
}

function spawnStep(step: Step, flags: SpawnFlags): number {
    const args: string[] = [join(DOCS_SCRIPTS_DIR, step.script)];
    if (flags.check && step.supportsCheck) args.push("--check");
    if (flags.verbose && step.supportsVerbose) args.push("--verbose");

    const result = spawnSync(process.execPath, args, {
        cwd: ROOT,
        stdio: "inherit",
    });

    if (result.error) {
        console.error(
            `   ✗ failed to spawn ${step.script}: ${result.error.message}`
        );
        return 1;
    }
    return result.status ?? 1;
}

/**
 * Write a step repeatedly until a follow-up `--check` is clean, capped at
 * MAX_CONVERGENCE_PASSES. A real writer error (non-zero write exit) aborts.
 * If the cap is hit without converging, returns 0 (best-effort) and warns —
 * lingering drift is most often a concurrent editor changing inputs mid-run.
 */
function runToFixedPoint(step: Step, opts: CliOptions): number {
    for (let pass = 1; pass <= MAX_CONVERGENCE_PASSES; pass++) {
        const writeCode = spawnStep(step, {
            check: false,
            verbose: opts.verbose,
        });
        if (writeCode !== 0) return writeCode;

        const checkCode = spawnStep(step, { check: true, verbose: false });
        if (checkCode === 0) {
            if (pass > 1) console.log(`   ↳ converged after ${pass} passes`);
            return 0;
        }
        console.log(
            `   ↳ pass ${pass} left drift — re-running (single-pass writer propagates child summaries to parents one level per pass)`
        );
    }
    console.error(
        `   ⚠ ${step.script} did not converge after ${MAX_CONVERGENCE_PASSES} passes (concurrent edits to the doc tree?)`
    );
    return 0;
}

function runStep(step: Step, opts: CliOptions): number {
    if (!opts.check && step.convergeInWrite) return runToFixedPoint(step, opts);
    return spawnStep(step, { check: opts.check, verbose: opts.verbose });
}

function main(): void {
    const opts = parseArgs(process.argv.slice(2));
    const mode = opts.check ? "check" : "write";
    const steps = STEPS.filter((s) => !opts.check || s.runInCheck);

    console.log(
        `\n📚 generate-all-docs — ${mode} mode (${steps.length} steps)`
    );

    let failures = 0;
    for (const [i, step] of steps.entries()) {
        console.log(
            `\n── [${i + 1}/${steps.length}] ${step.label}  (${step.script})`
        );
        const code = runStep(step, opts);
        if (code === 0) continue;

        failures++;
        console.error(`   ↳ exited ${code}`);
        if (!opts.check) {
            // Write mode is fail-fast: a non-zero exit is a real error.
            console.error(`\n✗ Aborted at step ${i + 1} — see output above.`);
            process.exit(code);
        }
    }

    if (failures > 0) {
        console.error(`\n✗ ${failures} step(s) reported drift or errors.`);
        if (opts.check) {
            console.error(
                "Run `bun scripts/docs/generate-all-docs.ts` to rewrite."
            );
        }
        process.exit(1);
    }

    console.log(`\n✓ All ${steps.length} documentation steps completed clean.`);
    process.exit(0);
}

main();
