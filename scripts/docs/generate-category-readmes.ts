#!/usr/bin/env bun

/**
 * generate-category-readmes — for every `packages/<category>/` folder that
 * contains at least one workspace package, write a `README.md` containing:
 *
 *   1. The contents of `packages/<category>/_intro.md` verbatim, if present.
 *   2. An auto-generated table of the packages directly inside that
 *      category, each row linking to the package's own README and showing
 *      the first-paragraph description of that README (or its
 *      `package.json` description) as the second column.
 *
 * This template's layout is 2-level (`packages/<category>/<pkg>/`) — there is
 * no subcategory tier, unlike a 3-level `packages/<category>/<subcategory>/<pkg>/`
 * layout. Package enumeration for each category is delegated to
 * `discoverPackageDirs()` (scoped to that category's directory) rather than a
 * hand-rolled walk, so flat and nested fallbacks keep working automatically.
 *
 * Categories with zero packages (e.g. an empty scaffold folder) are skipped
 * rather than treated as an error — this script runs cleanly against a repo
 * with no packages yet.
 *
 * Re-runs are idempotent. The auto section is enclosed in
 * `<!-- begin:auto-docs -->`…`<!-- end:auto-docs -->` markers; the intro
 * file (when present) is dropped in above.
 *
 * Usage:
 *   bun scripts/docs/generate-category-readmes.ts            # rewrite
 *   bun scripts/docs/generate-category-readmes.ts --check    # exit 1 on drift
 */

import { type Dirent, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CONFIG } from "../lib/config.js";
import { discoverPackageDirs } from "../lib/discover-packages.js";
import {
    AUTO_MARKER_BEGIN,
    AUTO_MARKER_END,
    firstBodyParagraph,
    isDirectorySafe,
    tryRead,
} from "../lib/doc-tree.js";

const ROOT = CONFIG.paths.root;
const PACKAGES_ROOT = join(ROOT, CONFIG.paths.packagesRoot);

interface CategoryPackage {
    name: string;
    description: string;
    relPath: string;
}

function describePackageReadme(readmePath: string, fallback: string): string {
    const content = tryRead(readmePath) ?? "";
    if (!content) return fallback;
    return firstBodyParagraph(content, 160) || fallback;
}

function escapeCell(s: string): string {
    return s.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function readWorkspacePackage(
    pkgDir: string,
    relPath: string
): CategoryPackage | null {
    const pkgRaw = tryRead(join(pkgDir, "package.json"));
    if (!pkgRaw) return null;
    let pkg: { name?: string; description?: string };
    try {
        pkg = JSON.parse(pkgRaw) as { name?: string; description?: string };
    } catch {
        return null;
    }
    const name = pkg.name?.trim();
    if (!name) return null;
    const description = describePackageReadme(
        join(pkgDir, "README.md"),
        (pkg.description ?? "").trim()
    );
    return { name, description, relPath };
}

async function collectCategoryPackages(
    categoryName: string
): Promise<CategoryPackage[]> {
    const pkgDirs = await discoverPackageDirs({
        root: ROOT,
        packagesRoot: join(CONFIG.paths.packagesRoot, categoryName),
    });
    const out: CategoryPackage[] = [];
    for (const pkgDir of pkgDirs) {
        const record = readWorkspacePackage(pkgDir, basename(pkgDir));
        if (record !== null) out.push(record);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

function renderPackageTable(packages: readonly CategoryPackage[]): string {
    const rows = packages
        .map((p) => {
            const link = `[\`${p.name}\`](./${p.relPath}/README.md)`;
            return `| ${link} | ${escapeCell(p.description || "—")} |`;
        })
        .join("\n");
    return ["| Package | Description |", "|---|---|", rows].join("\n");
}

function renderAutoBlock(
    categoryName: string,
    packages: readonly CategoryPackage[]
): string {
    const lines = [
        `## Packages in \`${categoryName}\``,
        "",
        `${packages.length} package${packages.length === 1 ? "" : "s"}.`,
        "",
        renderPackageTable(packages),
    ];
    return lines.join("\n");
}

function buildReadme(
    categoryName: string,
    intro: string | undefined,
    packages: readonly CategoryPackage[]
): string {
    const header = intro?.trim()
        ? intro.trim()
        : [
              `# \`${categoryName}\``,
              "",
              `Auto-generated index of the workspace packages under \`packages/${categoryName}/\`. Drop a hand-authored \`_intro.md\` in this directory to replace this default header.`,
          ].join("\n");
    const auto = renderAutoBlock(categoryName, packages);
    return `${header}\n\n${AUTO_MARKER_BEGIN}\n${auto}\n${AUTO_MARKER_END}\n`;
}

interface CliOptions {
    check: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
    let check = false;
    for (const arg of argv) {
        if (arg === "--check") check = true;
        else throw new Error(`Unknown flag: ${arg}`);
    }
    return { check };
}

async function main(): Promise<void> {
    let options: CliOptions;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    if (!isDirectorySafe(PACKAGES_ROOT)) {
        console.error(`Packages root not found: ${PACKAGES_ROOT}`);
        process.exit(2);
    }

    let categoryEntries: Dirent[];
    try {
        categoryEntries = readdirSync(PACKAGES_ROOT, { withFileTypes: true });
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
    }

    let updated = 0;
    let unchanged = 0;
    let empty = 0;

    for (const cat of categoryEntries) {
        if (!cat.isDirectory()) continue;
        if (cat.name.startsWith(".")) continue;
        const categoryDir = join(PACKAGES_ROOT, cat.name);
        const packages = await collectCategoryPackages(cat.name);
        if (packages.length === 0) {
            empty++;
            continue;
        }
        const introPath = join(categoryDir, "_intro.md");
        const intro = tryRead(introPath);
        const next = buildReadme(cat.name, intro, packages);
        const readmePath = join(categoryDir, "README.md");
        const current = tryRead(readmePath) ?? "";
        if (current === next) {
            unchanged++;
            continue;
        }
        if (!options.check) writeFileSync(readmePath, next);
        updated++;
    }

    console.log("");
    console.log(`✏️  Updated:    ${updated}`);
    console.log(`⏭️  Unchanged:  ${unchanged}`);
    console.log(`⚠️  Empty:      ${empty}`);
    if (updated === 0 && unchanged === 0) {
        console.log("\nNo categories have packages yet — nothing to document.");
    }

    if (options.check && updated > 0) {
        console.error("");
        console.error("Drift detected — run without --check to rewrite.");
        process.exit(1);
    }
    process.exit(0);
}

void main();
