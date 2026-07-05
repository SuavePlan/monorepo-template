#!/usr/bin/env bun
/**
 * §16 lint: conformance harnesses live with the contract, not the
 * implementation.
 *
 * See openspec/AGENTS.md §16. When a contract package exports a type `X`,
 * it MUST also export a runnable conformance harness `runXConformance(...)`
 * from its `./testing` subpath. Every package that ships a concrete
 * implementation of `X` (detected here as: depends on the contract package
 * AND the contract package exports a `./testing` subpath with a
 * `runXxxConformance` function) MUST include a `tests/conformance/*.test.ts`
 * that either imports `<contract-package-name>/testing` directly or invokes
 * one of the discovered `runXxxConformance` functions.
 *
 * This check is fully dynamic — it does not hardcode any package name or
 * npm scope. A contract-bearing dependency is discovered purely from
 * `package.json#exports["./testing"]` plus a `run\w+Conformance` function
 * declaration inside `src/testing/`.
 *
 * A consumer can opt out of a specific contract via
 * `package.json#conformanceSkip: ["<contract-dir-basename>"]` when the
 * dependency relationship is real but conformance genuinely does not apply
 * (document the reason in the consumer's README).
 *
 * Usage:
 *   bun scripts/lint/check-conformance-tests.ts
 *
 * Exit codes: 0 = no violations, 1 = at least one violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverPackageDirs } from "../lib/discover-packages.js";

const ROOT = resolve(import.meta.dir, "../..");

interface Pkg {
    readonly name: string;
    readonly basename: string;
    readonly dir: string;
    readonly deps: ReadonlySet<string>;
    readonly skip: ReadonlySet<string>;
    readonly hasTesting: boolean;
}

/** Last path segment of a package name — works for scoped and bare names. */
function shortName(name: string): string {
    const idx = name.lastIndexOf("/");
    return idx === -1 ? name : name.slice(idx + 1);
}

async function findPackages(): Promise<Pkg[]> {
    const pkgDirs = await discoverPackageDirs({ root: ROOT });
    const out: Pkg[] = [];
    for (const dir of pkgDirs) {
        const pj = join(dir, "package.json");
        let raw: {
            name?: string;
            dependencies?: Record<string, string>;
            exports?: Record<string, unknown>;
            conformanceSkip?: string[];
        };
        try {
            raw = JSON.parse(readFileSync(pj, "utf-8"));
        } catch {
            continue;
        }
        const name = raw.name;
        if (!name) continue;
        out.push({
            name,
            basename: shortName(name),
            dir,
            deps: new Set(Object.keys(raw.dependencies ?? {})),
            skip: new Set(raw.conformanceSkip ?? []),
            hasTesting: Object.keys(raw.exports ?? {}).includes("./testing"),
        });
    }
    return out;
}

function harnessExportsOf(pkg: Pkg): readonly string[] {
    if (!pkg.hasTesting) return [];
    const root = join(pkg.dir, "src", "testing");
    try {
        statSync(root);
    } catch {
        return [];
    }
    const names = new Set<string>();
    function scan(d: string): void {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const f = join(d, e.name);
            if (e.isDirectory()) scan(f);
            else if (e.isFile() && f.endsWith(".ts")) {
                const text = readFileSync(f, "utf-8");
                const re =
                    /export\s+(?:async\s+)?function\s+(run\w+Conformance)\s*\(/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    if (m[1]) names.add(m[1]);
                }
            }
        }
    }
    scan(root);
    return [...names];
}

function collectTestFiles(root: string, out: string[], depth = 0): void {
    if (depth > 8) return;
    let entries: ReturnType<typeof readdirSync>;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (
            e.name === "node_modules" ||
            e.name === "dist" ||
            e.name.startsWith(".")
        )
            continue;
        const full = join(root, e.name);
        if (e.isDirectory()) {
            collectTestFiles(full, out, depth + 1);
            continue;
        }
        if (!e.isFile()) continue;
        if (!full.endsWith(".test.ts") && !full.endsWith(".spec.ts")) continue;
        out.push(full);
    }
}

function hasConformanceTest(
    consumer: Pkg,
    contract: Pkg,
    harnesses: readonly string[]
): boolean {
    const candidates: string[] = [];
    collectTestFiles(join(consumer.dir, "tests"), candidates);
    collectTestFiles(join(consumer.dir, "src"), candidates);
    const harnessSet = new Set(harnesses);
    for (const file of candidates) {
        const base = file.split("/").pop() ?? "";
        if (!/conformance/i.test(base)) continue;
        let text: string;
        try {
            text = readFileSync(file, "utf-8");
        } catch {
            continue;
        }
        if (text.includes(`${contract.name}/testing`)) return true;
        for (const h of harnessSet) {
            // function-call invocation, possibly multiline whitespace before `(`
            const re = new RegExp(`\\b${h}\\s*\\(`);
            if (re.test(text)) return true;
        }
    }
    return false;
}

interface V {
    readonly consumer: string;
    readonly contract: string;
    readonly contractBasename: string;
    readonly harnesses: readonly string[];
}

async function main(): Promise<void> {
    const pkgs = await findPackages();
    const byName = new Map(pkgs.map((p) => [p.name, p]));

    const violations: V[] = [];
    for (const consumer of pkgs) {
        for (const dep of consumer.deps) {
            const contract = byName.get(dep);
            if (!contract || contract.basename === consumer.basename) continue;
            const harnesses = harnessExportsOf(contract);
            if (harnesses.length === 0) continue;
            if (consumer.skip.has(contract.basename)) continue;
            if (!hasConformanceTest(consumer, contract, harnesses)) {
                violations.push({
                    consumer: consumer.name,
                    contract: contract.name,
                    contractBasename: contract.basename,
                    harnesses,
                });
            }
        }
    }

    if (violations.length === 0) {
        console.log(
            `✓ check-conformance-tests: 0 violations across ${pkgs.length} packages`
        );
        return;
    }
    console.error(
        `✗ check-conformance-tests: ${violations.length} violation(s)`
    );
    console.error(
        "Per openspec/AGENTS.md §16, every package consuming a contract MUST run"
    );
    console.error(
        "the contract's conformance harness. Add tests/conformance/<contract>.test.ts.\n"
    );
    for (const v of violations) {
        console.error(`  ${v.consumer}`);
        console.error(`    consumes contract: ${v.contract}`);
        console.error(`    harnesses available: ${v.harnesses.join(", ")}`);
        console.error(
            `    fix: add tests/conformance/${v.contractBasename}.test.ts`
        );
    }
    process.exit(1);
}

await main();
