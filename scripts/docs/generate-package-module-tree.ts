#!/usr/bin/env bun

/**
 * generate-package-module-tree — for every workspace package, inject a
 * recursive "Documentation tree" section into the package README and into
 * every parent module .md that has descendant .mds.
 *
 * The section is enclosed in:
 *
 *   <!-- begin:auto-docs -->
 *   ## Documentation tree
 *
 *   - [<dir-name>](./relative/path.md) — first-paragraph description
 *   - ...
 *   <!-- end:auto-docs -->
 *
 * On rerun, the markers are found and the body is replaced in place. If
 * markers don't exist, the block is inserted before the first `## ` heading
 * (or appended at the end if none).
 *
 * The walk descends from each package's `src/` directory. For each direct
 * subdirectory it finds the canonical `.md` (`<dirname>.md` ⟶ `README.md` ⟶
 * single-md fallback). That .md becomes the child link. Recursion continues
 * inside the subdirectory: any sub-subdirectories with their own canonical
 * .mds become children of the previously discovered .md, and so on to leaves.
 *
 * Packages are discovered via `discoverPackageDirs` (2-level canonical
 * `packages/<category>/<pkg>/`, with flat/3-level fallbacks) — no fixed-depth
 * walk is hand-rolled here. `apps/*` and `e2e/*` workspace members (this
 * template's other two workspace globs) are swept in the same pass so their
 * READMEs get a documentation tree too, when they have one.
 *
 * Usage:
 *   bun scripts/docs/generate-package-module-tree.ts            # rewrite
 *   bun scripts/docs/generate-package-module-tree.ts --check    # exit 1 on drift
 *   bun scripts/docs/generate-package-module-tree.ts --verbose
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CONFIG } from "../lib/config.js";
import { discoverPackageDirs } from "../lib/discover-packages.js";
import {
    findCanonicalMd,
    firstBodyParagraph,
    isDirectorySafe,
    relForLink,
    replaceMarkedSection,
    tryRead,
} from "../lib/doc-tree.js";

const ROOT = CONFIG.paths.root;
const APPS_ROOT = join(ROOT, "apps");
const E2E_ROOT = join(ROOT, "e2e");
const OPENSPEC_SPECS = join(ROOT, "openspec", "specs");

interface ModuleNode {
    /** Display name (the directory name). */
    name: string;
    /** Absolute path to the canonical `.md`. */
    mdPath: string;
    /** First-paragraph description (already truncated). */
    description: string;
    /** Recursive children — modules whose canonical .md lives under this one's dir. */
    children: ModuleNode[];
}

function listSubdirs(dir: string): string[] {
    let entries: ReturnType<typeof readdirSync>;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter(
            (n) => !n.startsWith(".") && n !== "node_modules" && n !== "dist"
        )
        .sort();
}

function listDirectMds(dir: string, exclude: ReadonlySet<string>): string[] {
    let entries: ReturnType<typeof readdirSync>;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const out: string[] = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        if (entry.name.endsWith(".types.md")) continue;
        if (entry.name === "README.md") continue;
        if (exclude.has(entry.name)) continue;
        out.push(entry.name);
    }
    out.sort();
    return out;
}

function buildModuleTree(
    dir: string,
    excludeFromDirect: ReadonlySet<string> = new Set()
): ModuleNode[] {
    const out: ModuleNode[] = [];
    const claimed = new Set<string>();

    for (const sub of listSubdirs(dir)) {
        const subDir = join(dir, sub);
        const md = findCanonicalMd(subDir, sub);
        if (!md) {
            // Subdir without a canonical doc — attach its leaves at this level.
            const grand = buildModuleTree(subDir);
            for (const node of grand) out.push(node);
            continue;
        }
        const content = tryRead(md) ?? "";
        const description = firstBodyParagraph(content);
        // Exclude the canonical file from its own directory's direct listing so
        // it doesn't appear as a self-referential child when findCanonicalMd
        // used the single-file fallback.
        const children = buildModuleTree(subDir, new Set([basename(md)]));
        out.push({ name: sub, mdPath: md, description, children });
    }

    // Pick up flat `.md` files directly in this directory (covers packages
    // whose `src/*.md` are concept-per-file).
    const allExcluded =
        excludeFromDirect.size > 0
            ? new Set([...claimed, ...excludeFromDirect])
            : claimed;
    for (const fileName of listDirectMds(dir, allExcluded)) {
        const mdPath = join(dir, fileName);
        const content = tryRead(mdPath) ?? "";
        const description = firstBodyParagraph(content);
        const displayName = fileName.replace(/\.md$/, "");
        out.push({ name: displayName, mdPath, description, children: [] });
    }

    return out;
}

function renderTree(
    nodes: readonly ModuleNode[],
    from: string,
    depth = 0
): string {
    if (nodes.length === 0) return "";
    const indent = "  ".repeat(depth);
    const lines: string[] = [];
    for (const node of nodes) {
        const link = relForLink(from, node.mdPath);
        const desc = node.description ? ` — ${node.description}` : "";
        lines.push(`${indent}- [${node.name}](${link})${desc}`);
        if (node.children.length > 0) {
            lines.push(renderTree(node.children, from, depth + 1));
        }
    }
    return lines.filter((l) => l !== "").join("\n");
}

interface Stats {
    updated: number;
    unchanged: number;
    skipped: number;
    missingReadme: number;
}

function processFile(
    from: string,
    children: readonly ModuleNode[],
    heading: string,
    options: { check: boolean; verbose: boolean }
): "updated" | "unchanged" | "skipped" {
    const content = tryRead(from);
    if (content === undefined) return "skipped";
    if (children.length === 0) {
        // Leaf — strip any existing auto block but otherwise leave alone.
        const stripped = replaceMarkedSection(content, "_(no submodules)_");
        if (stripped.next === content) return "unchanged";
        // Only write the strip-to-stub if markers existed. If markers didn't
        // exist (leaf with no auto section yet), skip — nothing to inject.
        if (!content.includes("<!-- begin:auto-docs -->")) return "unchanged";
        if (!options.check) writeFileSync(from, stripped.next);
        if (options.verbose) console.log(`   stripped leaf: ${from}`);
        return "updated";
    }
    const body = `## ${heading}\n\n${renderTree(children, from)}`;
    const result = replaceMarkedSection(content, body);
    if (!result.changed) return "unchanged";
    if (!options.check) writeFileSync(from, result.next);
    if (options.verbose) console.log(`   updated: ${from}`);
    return "updated";
}

const SPEC_MARKER_BEGIN = "<!-- begin:auto-spec-link -->";
const SPEC_MARKER_END = "<!-- end:auto-spec-link -->";

function ensureSpecFooter(
    readmePath: string,
    specPath: string,
    options: { check: boolean; verbose: boolean },
    stats: Stats
): void {
    const content = tryRead(readmePath);
    if (content === undefined) return;
    const link = relForLink(readmePath, specPath);
    const block = [
        SPEC_MARKER_BEGIN,
        "## OpenSpec",
        "",
        `Canonical capability spec: [\`${link}\`](${link}).`,
        SPEC_MARKER_END,
    ].join("\n");
    const beginIdx = content.indexOf(SPEC_MARKER_BEGIN);
    const endIdx = content.indexOf(SPEC_MARKER_END);
    let next: string;
    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
        next = `${content.slice(0, beginIdx)}${block}${content.slice(endIdx + SPEC_MARKER_END.length)}`;
    } else {
        const trimmed = content.replace(/\s+$/u, "");
        next = `${trimmed}\n\n${block}\n`;
    }
    if (next === content) {
        stats.unchanged++;
        return;
    }
    if (!options.check) writeFileSync(readmePath, next);
    stats.updated++;
    if (options.verbose) console.log(`   spec-link: ${readmePath}`);
}

function visitTree(
    nodes: readonly ModuleNode[],
    options: { check: boolean; verbose: boolean },
    stats: Stats
): void {
    for (const node of nodes) {
        const result = processFile(
            node.mdPath,
            node.children,
            "Submodules",
            options
        );
        if (result === "updated") stats.updated++;
        else if (result === "unchanged") stats.unchanged++;
        else stats.skipped++;
        if (node.children.length > 0) visitTree(node.children, options, stats);
    }
}

/** Direct children of `root` (e.g. `apps/`, `e2e/`) that carry their own `package.json`. */
function listWorkspaceMembers(root: string): string[] {
    if (!isDirectorySafe(root)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const memberDir = join(root, entry.name);
        if (tryRead(join(memberDir, "package.json"))) out.push(memberDir);
    }
    return out;
}

interface CliOptions {
    check: boolean;
    verbose: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
    let check = false;
    let verbose = false;
    for (const arg of argv) {
        if (arg === "--check") check = true;
        else if (arg === "--verbose" || arg === "-v") verbose = true;
        else throw new Error(`Unknown flag: ${arg}`);
    }
    return { check, verbose };
}

async function main(): Promise<void> {
    let options: CliOptions;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    const pkgDirs = await discoverPackageDirs();
    const stats: Stats = {
        updated: 0,
        unchanged: 0,
        skipped: 0,
        missingReadme: 0,
    };

    const targets: string[] = [
        ...pkgDirs,
        ...listWorkspaceMembers(APPS_ROOT),
        ...listWorkspaceMembers(E2E_ROOT),
    ];

    if (targets.length === 0) {
        console.log("\nNo workspace packages found yet — nothing to document.");
        process.exit(0);
    }

    for (const pkgDir of targets) {
        const readmePath = join(pkgDir, "README.md");
        const original = tryRead(readmePath);
        if (original === undefined) {
            stats.missingReadme++;
            continue;
        }
        const srcDir = join(pkgDir, "src");
        const roots = isDirectorySafe(srcDir) ? buildModuleTree(srcDir) : [];

        const pkgResult = processFile(
            readmePath,
            roots,
            "Documentation tree",
            options
        );
        if (pkgResult === "updated") stats.updated++;
        else if (pkgResult === "unchanged") stats.unchanged++;
        else stats.skipped++;

        // OpenSpec spec link — if `openspec/specs/<shortName>/spec.md` exists
        // and isn't already referenced in the README, append a small footer
        // section between auto-spec markers so the spec joins the doc tree.
        const shortName = basename(pkgDir);
        const specPath = join(OPENSPEC_SPECS, shortName, "spec.md");
        if (existsSync(specPath)) {
            ensureSpecFooter(readmePath, specPath, options, stats);
        }

        visitTree(roots, options, stats);
        if (options.verbose) {
            console.log(
                `   ${basename(pkgDir)}: ${roots.length} root module(s)`
            );
        }
    }

    console.log("");
    console.log(`✏️  Updated:         ${stats.updated}`);
    console.log(`⏭️  Unchanged:       ${stats.unchanged}`);
    console.log(`⚠️  Missing README:  ${stats.missingReadme}`);
    if (stats.skipped > 0) {
        console.log(`⚠️  Skipped:         ${stats.skipped}`);
    }

    if (options.check && stats.updated > 0) {
        console.error("");
        console.error("Drift detected — run without --check to rewrite.");
        process.exit(1);
    }
    process.exit(0);
}

void main();
