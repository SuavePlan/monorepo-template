#!/usr/bin/env bun

/**
 * generate-packages-root-readme — writes `./packages/README.md` with a full
 * drill-down of every category and workspace package.
 *
 *   1. The contents of `packages/_intro.md` verbatim, if present.
 *   2. An auto-generated hierarchy:
 *        ## Categories
 *        ### `category`
 *        (category _intro.md)
 *        | Package | Description |
 *        ...
 *
 * This template's layout is 2-level (`packages/<category>/<pkg>/`) — there is
 * no subcategory tier, so each category section lists its packages directly.
 * Package identity and description come from the package's own
 * `package.json` (`name`/`description`) — no npm-scope prefix is assumed.
 *
 * Packages are discovered once via `discoverPackageDirs()` and grouped by
 * category (the immediate parent directory name of each package dir), rather
 * than a hand-rolled fixed-depth walk.
 *
 * Re-runs are idempotent. The auto section is enclosed in
 * `<!-- begin:auto-docs -->`…`<!-- end:auto-docs -->` markers.
 *
 * Zero-package safety: when no workspace package exists yet, this still
 * writes a valid `packages/README.md` with a "no packages yet" notice
 * instead of failing.
 *
 * Usage:
 *   bun scripts/docs/generate-packages-root-readme.ts            # rewrite
 *   bun scripts/docs/generate-packages-root-readme.ts --check    # exit 1 on drift
 */

import { writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
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

interface RootPackage {
    name: string;
    description: string;
    relPath: string;
}

interface Category {
    name: string;
    intro: string;
    packages: RootPackage[];
}

function describePackageReadme(readmePath: string, fallback: string): string {
    const content = tryRead(readmePath) ?? "";
    if (!content) return fallback;
    return firstBodyParagraph(content, 160) || fallback;
}

function escapeCell(s: string): string {
    return s.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

/**
 * A package's category is the immediate parent directory name of its dir
 * (`packages/<category>/<pkg>` → `<category>`). A package that sits directly
 * under the packages root (the flat-layout fallback) has no category folder
 * of its own and is bucketed as `uncategorized`.
 */
function categoryOf(pkgDir: string): string {
    const parent = dirname(pkgDir);
    return parent === PACKAGES_ROOT ? "uncategorized" : basename(parent);
}

function readWorkspacePackage(
    pkgDir: string,
    relPath: string
): RootPackage | null {
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

async function collectCategories(): Promise<Category[]> {
    const pkgDirs = await discoverPackageDirs();
    const byCategory = new Map<string, RootPackage[]>();

    for (const pkgDir of pkgDirs) {
        const relPath = relative(PACKAGES_ROOT, pkgDir).split("\\").join("/");
        const record = readWorkspacePackage(pkgDir, relPath);
        if (!record) continue;
        const category = categoryOf(pkgDir);
        const list = byCategory.get(category) ?? [];
        list.push(record);
        byCategory.set(category, list);
    }

    const categories: Category[] = [];
    for (const [name, packages] of byCategory) {
        packages.sort((a, b) => a.name.localeCompare(b.name));
        const introRaw = tryRead(join(PACKAGES_ROOT, name, "_intro.md"));
        categories.push({ name, intro: introRaw?.trim() ?? "", packages });
    }
    categories.sort((a, b) => a.name.localeCompare(b.name));
    return categories;
}

function renderPackageTable(packages: readonly RootPackage[]): string {
    const rows = packages
        .map((p) => {
            const link = `[\`${p.name}\`](./${p.relPath}/README.md)`;
            return `| ${link} | ${escapeCell(p.description || "—")} |`;
        })
        .join("\n");
    return ["| Package | Description |", "|---|---|", rows].join("\n");
}

function stripLeadingH1(content: string): string {
    return content.replace(/^#\s+.*$/m, "").trim();
}

function renderAutoBlock(categories: readonly Category[]): string {
    if (categories.length === 0) {
        return [
            "## Categories",
            "",
            "No packages yet. Scaffold your first package under `packages/<category>/<pkg>/`, then run `bun scripts/docs/generate-all-docs.ts` to populate this index.",
        ].join("\n");
    }

    const totalPackages = categories.reduce(
        (sum, cat) => sum + cat.packages.length,
        0
    );

    const catSections = categories
        .map((cat) => {
            const lines: string[] = [];
            lines.push(`### \`${cat.name}\``);
            lines.push("");
            if (cat.intro) {
                lines.push(stripLeadingH1(cat.intro));
                lines.push("");
            }
            lines.push(renderPackageTable(cat.packages));
            return lines.join("\n").trimEnd();
        })
        .join("\n\n");

    return [
        "## Categories",
        "",
        `${categories.length} categor${categories.length === 1 ? "y" : "ies"}, ${totalPackages} package${totalPackages === 1 ? "" : "s"}.`,
        "",
        catSections,
    ].join("\n");
}

function buildReadme(
    intro: string | undefined,
    categories: readonly Category[]
): string {
    const header = intro?.trim()
        ? intro.trim()
        : [
              "# `packages`",
              "",
              "Auto-generated index of every workspace package in the monorepo. Drop a hand-authored `_intro.md` in this directory to replace this default header.",
          ].join("\n");
    const auto = renderAutoBlock(categories);
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

    const categories = await collectCategories();

    const introPath = join(PACKAGES_ROOT, "_intro.md");
    const intro = tryRead(introPath);
    const next = buildReadme(intro, categories);
    const readmePath = join(PACKAGES_ROOT, "README.md");
    const current = tryRead(readmePath) ?? "";

    if (current === next) {
        console.log("");
        console.log("⏭️  Unchanged:  1");
        process.exit(0);
    }

    if (!options.check) writeFileSync(readmePath, next);
    console.log("");
    console.log(`${options.check ? "🔍 Would update" : "✏️  Updated"}:    1`);
    console.log("⏭️  Unchanged:  0");

    if (options.check) {
        console.error("");
        console.error("Drift detected — run without --check to rewrite.");
        process.exit(1);
    }
    process.exit(0);
}

void main();
