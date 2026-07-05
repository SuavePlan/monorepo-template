#!/usr/bin/env bun
/**
 * docs-check — verify every non-excluded `.ts(x)` implementation file in a
 * package's src/ tree has a co-located sibling `.md` meeting CLAUDE.md rules:
 *
 *   - Required headings (H2 or H3): Purpose, Features, Usage (or Basic Example
 *     + Advanced Example), API Reference, Implementation Notes
 *   - >=200 words excluding fenced code blocks
 *
 * Usage: bun scripts/docs-check.ts [<package-dir>]  (defaults to cwd)
 * Exits 0 on full pass, 1 on any violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

type Violation = { file: string; reason: string };

const EXCLUDE_FILE = [
    /\.test\.tsx?$/,
    /\.spec\.tsx?$/,
    /\.stories\.tsx?$/,
    /\.bench\.ts$/,
    /\.d\.ts$/,
    // Generated `*.data.ts` modules are data, not implementation: they hold
    // embedded tables emitted by a deterministic generator, carry no
    // hand-written logic, and are exempt from the sibling-`.md` contract (and
    // the file-size budget). A sibling `.md` MAY still accompany one, but is
    // never required. Provenance lives in a sibling `*.provenance.md`.
    /\.data\.tsx?$/,
];

const REQUIRED_HEADINGS: { label: string; test: (h: string[]) => boolean }[] = [
    { label: "Purpose", test: (h) => h.some((x) => /^purpose\b/.test(x)) },
    { label: "Features", test: (h) => h.some((x) => /^features\b/.test(x)) },
    {
        label: "Usage (basic + advanced)",
        test: (h) => {
            const hasBasic = h.some((x) => /basic\s+example/.test(x));
            const hasAdvanced = h.some((x) => /advanced\s+example/.test(x));
            const hasUsage = h.some((x) => /^usage\b/.test(x));
            return (hasBasic && hasAdvanced) || hasUsage;
        },
    },
    {
        label: "API Reference",
        test: (h) => h.some((x) => /api\s+reference/.test(x)),
    },
    {
        label: "Implementation Notes",
        test: (h) => h.some((x) => /implementation\s+notes/.test(x)),
    },
];

function walk(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const name of entries) {
        if (name === "node_modules" || name === "dist" || name === "coverage")
            continue;
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

function isExcluded(file: string, srcRoot: string): boolean {
    const name = basename(file);
    if (EXCLUDE_FILE.some((rx) => rx.test(name))) return true;

    const rel = relative(srcRoot, file);
    const parts = rel.split(sep);

    if (parts[0] === "constants") return true;
    if (parts.some((p) => p === "__benchmarks__" || p === "__fixtures__"))
        return true;

    if (name === "index.ts" || name === "index.tsx") return true;

    if (/\.types\.tsx?$/.test(name)) {
        if (parts[0] === "types" && parts.length === 2) return false;
        return true;
    }

    // *.schemas.ts — co-located Zod schemas are pure data-shape definitions,
    // semantically equivalent to *.types.ts. Documented via the sibling feature
    // module's .md (e.g. decay.md covers decay.ts AND decay.schemas.ts).
    if (/\.schemas\.tsx?$/.test(name)) return true;

    return false;
}

function stripCodeBlocks(md: string): string {
    return md.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

function extractHeadings(md: string): string[] {
    const out: string[] = [];
    for (const line of md.split(/\r?\n/)) {
        const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
        if (m) out.push(m[2].toLowerCase().trim());
    }
    return out;
}

function wordCount(text: string): number {
    const matches = text.match(/\b[\p{L}\p{N}][\p{L}\p{N}'_-]*\b/gu);
    return matches ? matches.length : 0;
}

function validateMarkdown(mdPath: string): string[] {
    const raw = readFileSync(mdPath, "utf8");
    const stripped = stripCodeBlocks(raw);
    const words = wordCount(stripped);
    const headings = extractHeadings(raw);
    const issues: string[] = [];

    for (const req of REQUIRED_HEADINGS) {
        if (!req.test(headings)) issues.push(`missing section: ${req.label}`);
    }
    if (words < 200)
        issues.push(`word count ${words} < 200 (excl. code blocks)`);
    return issues;
}

function main(): number {
    const pkgDir = resolve(process.argv[2] ?? ".");
    const srcRoot = join(pkgDir, "src");

    let files: string[];
    try {
        statSync(srcRoot);
        files = walk(srcRoot);
    } catch {
        console.log(`[docs-check] no src/ at ${pkgDir} - skipping`);
        return 0;
    }

    const candidates = files.filter(
        (f) =>
            /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && !isExcluded(f, srcRoot)
    );

    const violations: Violation[] = [];
    let passed = 0;

    for (const ts of candidates) {
        const md = ts.replace(/\.tsx?$/, ".md");
        const rel = relative(pkgDir, ts);
        try {
            statSync(md);
        } catch {
            violations.push({ file: rel, reason: "missing sibling .md" });
            console.log(`  MISS ${rel} - missing sibling .md`);
            continue;
        }
        const issues = validateMarkdown(md);
        if (issues.length > 0) {
            for (const issue of issues) {
                violations.push({ file: rel, reason: issue });
                console.log(`  FAIL ${rel} - ${issue}`);
            }
        } else {
            passed++;
        }
    }

    const total = candidates.length;
    const pct = total === 0 ? 100 : Math.round((passed / total) * 100);
    const pkgName = basename(dirname(srcRoot)) || basename(pkgDir);
    console.log(
        `[${pkgName}] Docs coverage: ${passed}/${total} files (${pct}%)`
    );

    return violations.length === 0 ? 0 : 1;
}

process.exit(main());
