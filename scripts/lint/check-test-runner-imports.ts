#!/usr/bin/env bun
/**
 * check-test-runner-imports.ts
 *
 * CI gate enforcing the canonical test-runner-import rule defined in:
 *   - openspec/AGENTS.md §7 "Test runner imports — mandatory"
 *   - CLAUDE.md §3 Critical Rules (11)
 *
 * For every package discovered under `packages/` whose `package.json#name`
 * is NOT in the exempt allowlist, this script scans src/**\/*.{ts,tsx} for
 * direct imports from "vitest" or "bun:test" and exits non-zero with a
 * per-file error list when any are found.
 *
 * Exempt allowlist comes from `scripts/lib/config.ts`
 * `CONFIG.testing.exemptRunnerWrapperPackages` — the only packages permitted
 * to import vitest / bun:test directly, because they author or extend the
 * project's runner-neutral test wrapper. That list is empty until this
 * project creates its own testing-wrapper package; until then EVERY package
 * is subject to the rule. Adding a package to the allowlist requires its own
 * OpenSpec change with justification — extending fixtures or being a heavy
 * consumer of the testing package does NOT qualify.
 *
 * Usage:
 *   bun scripts/lint/check-test-runner-imports.ts [--root <repo-root>]
 *
 * Exit codes:
 *   0  — all non-exempt packages clean
 *   1  — at least one violation found (details printed to stderr)
 *   2  — internal error (cannot read repo, unparsable package.json, etc.)
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { CONFIG } from "../lib/config.js";
import { discoverPackageDirs } from "../lib/discover-packages.js";

const FORBIDDEN_IMPORT_REGEX =
    /^[^/]*\bimport\b[^;]*?\bfrom\s+(['"])(vitest|bun:test)\1/m;

const FORBIDDEN_LINE_REGEX = /\bfrom\s+(['"])(vitest|bun:test)\1/;

export interface Violation {
    readonly packageName: string;
    readonly file: string;
    readonly line: number;
    readonly source: string;
}

export interface CheckOptions {
    readonly repoRoot: string;
    /**
     * Override the exempt-package allowlist. Defaults to
     * `CONFIG.testing.exemptRunnerWrapperPackages`.
     */
    readonly exemptPackages?: readonly string[];
    readonly discoverFn?: typeof discoverPackageDirs;
    readonly readDirFn?: typeof readdir;
    readonly readFileFn?: typeof readFile;
}

export async function findViolations(
    options: CheckOptions
): Promise<Violation[]> {
    const discoverImpl = options.discoverFn ?? discoverPackageDirs;
    const readDirImpl = options.readDirFn ?? readdir;
    const readFileImpl = options.readFileFn ?? readFile;
    const exemptPackages = new Set(
        options.exemptPackages ?? CONFIG.testing.exemptRunnerWrapperPackages
    );

    const violations: Violation[] = [];
    const pkgDirs = await discoverImpl({ root: options.repoRoot });

    for (const pkgDir of pkgDirs) {
        const manifestPath = join(pkgDir, "package.json");
        let manifestRaw: string;
        try {
            manifestRaw = await readFileImpl(manifestPath, "utf8");
        } catch {
            continue;
        }
        let manifest: { name?: string };
        try {
            manifest = JSON.parse(manifestRaw) as { name?: string };
        } catch (cause) {
            throw new Error(
                `Cannot parse ${manifestPath}: ${(cause as Error).message}`
            );
        }
        const name = manifest.name;
        if (typeof name !== "string" || name.length === 0) continue;
        if (exemptPackages.has(name)) continue;

        const srcDir = join(pkgDir, "src");
        await walkAndScan({
            dir: srcDir,
            packageName: name,
            repoRoot: options.repoRoot,
            violations,
            readDirFn: readDirImpl,
            readFileImpl,
        });
    }
    return violations;
}

interface WalkArgs {
    readonly dir: string;
    readonly packageName: string;
    readonly repoRoot: string;
    readonly violations: Violation[];
    readonly readDirFn: typeof readdir;
    readonly readFileImpl: typeof readFile;
}

async function walkAndScan(args: WalkArgs): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
        entries = await args.readDirFn(args.dir, { withFileTypes: true });
    } catch {
        // No src/ (or unreadable dir) — nothing to scan.
        return;
    }
    for (const entry of entries) {
        const fullPath = join(args.dir, entry.name);
        if (entry.isDirectory()) {
            await walkAndScan({ ...args, dir: fullPath });
            continue;
        }
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
            continue;
        }
        const content = await args.readFileImpl(fullPath, "utf8");
        if (!FORBIDDEN_IMPORT_REGEX.test(content)) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i] ?? "";
            if (/\bimport\b/.test(line) && FORBIDDEN_LINE_REGEX.test(line)) {
                // Skip lines that are obviously inside a backtick
                // template literal — code-generating scaffolders embed
                // test-runner imports as template strings for the files
                // they generate. Heuristic: the line starts with optional
                // indent and a backtick character (template-literal opener).
                const trimmed = line.trimStart();
                if (trimmed.startsWith("`") || trimmed.startsWith('"`')) {
                    continue;
                }
                args.violations.push({
                    packageName: args.packageName,
                    file: relative(args.repoRoot, fullPath),
                    line: i + 1,
                    source: line.trim(),
                });
            }
        }
    }
}

export function formatViolations(violations: readonly Violation[]): string {
    if (violations.length === 0) {
        return "All non-exempt packages use the project's runner-neutral test wrapper.";
    }
    const grouped = new Map<string, Violation[]>();
    for (const v of violations) {
        const list = grouped.get(v.packageName) ?? [];
        list.push(v);
        grouped.set(v.packageName, list);
    }
    const lines: string[] = [
        "❌ Direct vitest / bun:test imports detected in non-exempt packages.",
        "",
        "Rule: openspec/AGENTS.md §7 'Test runner imports — mandatory'.",
        "Fix:  rewrite each line to import from this project's runner-neutral",
        "      test wrapper (see CONFIG.testing.exemptRunnerWrapperPackages",
        "      in scripts/lib/config.ts for the wrapper package once it exists).",
        "",
    ];
    for (const [pkg, items] of [...grouped].sort((a, b) =>
        a[0].localeCompare(b[0])
    )) {
        lines.push(
            `  ${pkg} (${items.length} violation${items.length === 1 ? "" : "s"})`
        );
        for (const v of items) {
            lines.push(`    ${v.file}:${v.line}  ${v.source}`);
        }
        lines.push("");
    }
    lines.push(
        `Total: ${violations.length} violation${violations.length === 1 ? "" : "s"} across ${grouped.size} package${grouped.size === 1 ? "" : "s"}.`
    );
    return lines.join("\n");
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    let repoRoot = process.cwd();
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--root" && i + 1 < argv.length) {
            repoRoot = resolve(argv[i + 1] ?? ".");
            i += 1;
        }
    }
    let violations: readonly Violation[];
    try {
        violations = await findViolations({ repoRoot });
    } catch (cause) {
        process.stderr.write(
            `check-test-runner-imports: internal error: ${(cause as Error).message}\n`
        );
        process.exit(2);
    }
    const message = formatViolations(violations);
    if (violations.length === 0) {
        process.stdout.write(`${message}\n`);
        process.exit(0);
    }
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

if (import.meta.main) {
    await main();
}
