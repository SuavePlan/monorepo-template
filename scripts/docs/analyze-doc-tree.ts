#!/usr/bin/env bun

/**
 * analyze-doc-tree — walk the documentation tree from the root README
 * and report every `.md` file on disk that is NOT reachable through
 * the relative-link chain.
 *
 * Algorithm:
 *   1. Start at `<repo>/README.md`. Read it; follow every relative `.md`
 *      link target. Recurse into each linked file the same way. Record
 *      the visited set.
 *   2. Walk the filesystem for every `.md` under the repo (skipping
 *      node_modules, dist, build, coverage, .turbo, .vite, openspec/specs
 *      and friends by default; see `--ignore`).
 *   3. The difference is the orphan list.
 *
 * Usage:
 *   bun scripts/docs/analyze-doc-tree.ts                      # warn-only
 *   bun scripts/docs/analyze-doc-tree.ts --strict             # exit 1 on orphans
 *   bun scripts/docs/analyze-doc-tree.ts --ignore docs        # add ignore segments
 *   bun scripts/docs/analyze-doc-tree.ts --quiet              # counts only
 */

import { existsSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CONFIG } from "../lib/config.js";
import { extractRelativeMdLinks, tryRead, walkMd } from "../lib/doc-tree.js";

const ROOT = CONFIG.paths.root;

const DEFAULT_IGNORE_SEGMENTS: readonly string[] = [
    "openspec/archive",
    "openspec/changes",
    "openspec/templates",
    "openspec/specs",
    ".claude",
    ".cursor",
];

/**
 * File-name suffixes that are excluded from the orphan check. These files
 * exist on disk but are NOT part of the doc tree (sibling type-docs that
 * pair with `.types.ts` files, bundled agent skill manifests, etc.).
 *
 * `_intro.md` is included here (as a suffix, not just the repo-root path) —
 * every level (`packages/_intro.md`, `packages/<category>/_intro.md`, …) is
 * a transcluded source folded verbatim into its owning README's header, not
 * a linked tree node in its own right, so it is never reachable via a
 * relative-link crawl and would otherwise always report as an orphan.
 */
const DEFAULT_IGNORE_SUFFIXES: readonly string[] = [
    ".types.md",
    "SKILL.md",
    "CHANGELOG.md",
    "_intro.md",
];

interface CliOptions {
    strict: boolean;
    quiet: boolean;
    extraIgnore: string[];
}

function parseArgs(argv: readonly string[]): CliOptions {
    let strict = false;
    let quiet = false;
    const extraIgnore: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? "";
        if (arg === "--strict") strict = true;
        else if (arg === "--quiet" || arg === "-q") quiet = true;
        else if (arg === "--ignore") {
            const next = argv[i + 1];
            if (!next) throw new Error("--ignore requires a value");
            extraIgnore.push(next);
            i++;
        } else if (arg.startsWith("--ignore=")) {
            extraIgnore.push(arg.slice("--ignore=".length));
        } else {
            throw new Error(`Unknown flag: ${arg}`);
        }
    }
    return { strict, quiet, extraIgnore };
}

function normalize(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return resolve(path);
    }
}

function crawlVisited(
    startPath: string,
    ignoreSegments: readonly string[]
): Set<string> {
    const visited = new Set<string>();
    const queue: string[] = [normalize(startPath)];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        if (visited.has(current)) continue;
        if (!existsSync(current)) continue;
        visited.add(current);
        const content = tryRead(current);
        if (content === undefined) continue;
        const targets = extractRelativeMdLinks(content, current);
        for (const target of targets) {
            const resolved = normalize(target);
            if (ignoreSegments.some((s) => resolved.includes(`/${s}/`)))
                continue;
            if (!visited.has(resolved)) queue.push(resolved);
        }
    }
    return visited;
}

function main(): void {
    let options: CliOptions;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    const ignoreSegments = [...DEFAULT_IGNORE_SEGMENTS, ...options.extraIgnore];

    const rootReadme = join(ROOT, "README.md");
    if (!existsSync(rootReadme)) {
        console.log(
            "\nNo root README.md yet — run `bun scripts/docs/generate-root-readme.ts` first."
        );
        process.exit(0);
    }

    const visited = crawlVisited(rootReadme, ignoreSegments);
    const allMd = walkMd(ROOT, { ignoreSegments })
        .filter((p) => !DEFAULT_IGNORE_SUFFIXES.some((suf) => p.endsWith(suf)))
        .map(normalize);
    const onDisk = new Set(allMd);

    const orphans: string[] = [];
    for (const path of onDisk) {
        if (!visited.has(path)) orphans.push(path);
    }
    const broken: string[] = [];
    for (const path of visited) {
        if (onDisk.has(path)) continue;
        if (path.endsWith("README.md")) continue;
        // Files intentionally excluded from the on-disk set (sibling type docs,
        // bundled agent skills, etc.) are not "broken" — they were filtered out
        // by `DEFAULT_IGNORE_SUFFIXES`.
        if (DEFAULT_IGNORE_SUFFIXES.some((suf) => path.endsWith(suf))) continue;
        if (!existsSync(path)) broken.push(path);
    }

    orphans.sort();
    broken.sort();

    if (!options.quiet) {
        console.log("");
        console.log(`📚 Visited from root README: ${visited.size}`);
        console.log(`📂 .md files on disk:        ${onDisk.size}`);
        console.log(`❌ Orphans (unreachable):    ${orphans.length}`);
        console.log(`⚠️  Broken link targets:     ${broken.length}`);
        if (orphans.length > 0) {
            console.log("");
            console.log("Orphans:");
            for (const o of orphans.slice(0, 50)) {
                console.log(`   - ${relative(ROOT, o)}`);
            }
            if (orphans.length > 50) {
                console.log(`   … and ${orphans.length - 50} more`);
            }
        }
        if (broken.length > 0) {
            console.log("");
            console.log(
                "Broken link targets (referenced but missing on disk):"
            );
            for (const b of broken.slice(0, 50)) {
                console.log(`   - ${relative(ROOT, b)}`);
            }
            if (broken.length > 50) {
                console.log(`   … and ${broken.length - 50} more`);
            }
        }
    } else {
        console.log(
            `visited=${visited.size} disk=${onDisk.size} orphans=${orphans.length} broken=${broken.length}`
        );
    }

    if (options.strict && (orphans.length > 0 || broken.length > 0)) {
        process.exit(1);
    }
    process.exit(0);
}

main();
