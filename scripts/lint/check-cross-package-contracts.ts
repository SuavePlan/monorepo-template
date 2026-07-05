#!/usr/bin/env bun
/**
 * §15 lint: cross-package contracts must live in contract packages.
 *
 * See openspec/AGENTS.md §15 "Cross-package contracts must live in
 * contract packages". A type or interface that packages OTHER than the
 * defining one are expected to implement is a contract. Contracts must
 * live in a shared, zero/near-zero-dep contract package, not inside the
 * implementation package that happens to declare them first.
 *
 * This walks every `export interface X` / `export type X = ...`
 * declaration across every discovered package's `src/`, then checks every
 * `implements X` occurrence across every OTHER package's `src/`. If the
 * declaring package is not a recognized contract package, that's a
 * violation.
 *
 * Recognized contract packages are configured externally in
 * `scripts/lint/contract-packages.json` — a flat JSON array of package
 * DIRECTORY basenames (the folder name under `packages/<category>/`, e.g.
 * `"types"` or `"contracts"`), not npm package names. The file is empty
 * (`[]`) until this project designates its first contract package; if the
 * file is missing entirely, the check falls back to an empty set (every
 * cross-package `implements` is then a violation, which is the safe
 * default for a project with no contract package yet).
 *
 * A single-line `// @cross-package-contract` comment immediately above a
 * declaration suppresses it — for types deliberately kept narrow that no
 * other package is expected to implement.
 *
 * Usage:
 *   bun scripts/lint/check-cross-package-contracts.ts
 *
 * Exit codes: 0 = no violations, 1 = at least one violation.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { discoverPackageDirs } from "../lib/discover-packages.js";

const ROOT = resolve(import.meta.dir, "../..");
const CONTRACT_BASENAMES_PATH = join(import.meta.dir, "contract-packages.json");
const SUPPRESSION = "@cross-package-contract";

interface Decl {
    readonly name: string;
    readonly file: string;
    readonly pkg: string;
}

function loadContractBasenames(): ReadonlySet<string> {
    try {
        if (!existsSync(CONTRACT_BASENAMES_PATH)) return new Set();
        const parsed = JSON.parse(
            readFileSync(CONTRACT_BASENAMES_PATH, "utf-8")
        );
        if (!Array.isArray(parsed)) return new Set();
        return new Set(
            parsed.filter((entry): entry is string => typeof entry === "string")
        );
    } catch {
        return new Set();
    }
}

function walk(dir: string, out: string[]): void {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (
            e.name === "node_modules" ||
            e.name === "dist" ||
            e.name.startsWith(".")
        )
            continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (
            e.isFile() &&
            full.endsWith(".ts") &&
            !full.endsWith(".test.ts") &&
            !full.endsWith(".spec.ts") &&
            !full.endsWith(".stories.tsx")
        )
            out.push(full);
    }
}

async function collectFilesByPackage(): Promise<Map<string, string>> {
    const pkgDirs = await discoverPackageDirs({ root: ROOT });
    const fileToPkg = new Map<string, string>();
    for (const pkgDir of pkgDirs) {
        const pkgFiles: string[] = [];
        walk(pkgDir, pkgFiles);
        const pkgName = basename(pkgDir);
        for (const f of pkgFiles) fileToPkg.set(f, pkgName);
    }
    return fileToPkg;
}

async function main(): Promise<void> {
    const contractBasenames = loadContractBasenames();
    const fileToPkg = await collectFilesByPackage();
    const files = [...fileToPkg.keys()];

    const decls: Decl[] = [];
    for (const f of files) {
        const text = readFileSync(f, "utf-8");
        const lines = text.split("\n");
        const re = /^\s*export\s+(?:interface\s+(\w+)|type\s+(\w+)\s*[=<])/;
        for (let i = 0; i < lines.length; i++) {
            const prev = i > 0 ? (lines[i - 1] ?? "") : "";
            if (prev.includes(SUPPRESSION)) continue;
            const m = re.exec(lines[i] ?? "");
            if (!m) continue;
            const name = m[1] ?? m[2];
            const pkg = fileToPkg.get(f);
            if (!name || !pkg) continue;
            decls.push({ name, file: f, pkg });
        }
    }

    const byName = new Map<string, Decl>();
    for (const d of decls) byName.set(d.name, d);

    const violations = new Map<string, string[]>();
    const implRe = /\bimplements\s+([A-Z]\w*)/g;
    for (const f of files) {
        const consumerPkg = fileToPkg.get(f);
        if (!consumerPkg) continue;
        const text = readFileSync(f, "utf-8");
        implRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = implRe.exec(text)) !== null) {
            const name = m[1];
            if (!name) continue;
            const d = byName.get(name);
            if (!d || d.pkg === consumerPkg) continue;
            if (contractBasenames.has(d.pkg)) continue;
            const key = `${d.pkg}#${name}`;
            const arr = violations.get(key) ?? [];
            arr.push(`${relative(ROOT, f)} (${consumerPkg})`);
            violations.set(key, arr);
        }
    }

    if (violations.size === 0) {
        console.log(
            `✓ check-cross-package-contracts: 0 violations across ${files.length} files`
        );
        return;
    }
    console.error(
        `✗ check-cross-package-contracts: ${violations.size} violation(s)`
    );
    console.error(
        "Per openspec/AGENTS.md §15, these types should move to a contract package"
    );
    console.error(
        "OR add `// @cross-package-contract` above the declaration to document why.\n"
    );
    for (const [k, cs] of violations) {
        const [pkg, name] = k.split("#");
        console.error(`  ${name} (in ${pkg}):`);
        for (const c of cs) console.error(`    implemented by: ${c}`);
    }
    process.exit(1);
}

await main();
