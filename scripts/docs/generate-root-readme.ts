#!/usr/bin/env bun

/**
 * generate-root-readme — rebuild `README.md` at the repo root.
 *
 * The output has two regions:
 *
 *   1. **Header.** If `_intro.md` exists at the repo root, its contents are
 *      dropped in verbatim. Otherwise a default header is generated from the
 *      root `package.json` (`name`/`description`) plus a short stack summary
 *      and links to `CLAUDE.md`, `openspec/AGENTS.md`, and
 *      `packages/README.md`. This repo ships no root README yet, so the
 *      generated default is what a fresh clone sees until someone authors a
 *      real `_intro.md`.
 *   2. **Auto-generated category index.** A markdown table whose rows are
 *      `(category, # packages, link to packages/<category>/README.md)`.
 *      Wrapped in `<!-- begin:auto-docs -->`…`<!-- end:auto-docs -->`
 *      markers so future rewrites are surgical.
 *
 * The per-category READMEs are owned by `generate-category-readmes.ts`; the
 * per-package documentation trees are owned by
 * `generate-package-module-tree.ts`. This script intentionally stays at the
 * top of the doc spine — it does not duplicate package-level detail.
 *
 * Packages are discovered once via `discoverPackageDirs()` and grouped by
 * category (immediate parent directory name), not a hand-rolled walk. When
 * no packages exist yet, the category table is replaced with a short notice
 * instead of an empty (and invalid) markdown table.
 *
 * Usage:
 *   bun scripts/docs/generate-root-readme.ts            # rewrite README.md
 *   bun scripts/docs/generate-root-readme.ts --check    # exit 1 if drift
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CONFIG } from "../lib/config.js";
import { discoverPackageDirs } from "../lib/discover-packages.js";
import { isDirectorySafe, tryRead } from "../lib/doc-tree.js";

const ROOT = CONFIG.paths.root;
const README_PATH = join(ROOT, "README.md");
const INTRO_PATH = join(ROOT, "_intro.md");
const PACKAGES_ROOT = join(ROOT, CONFIG.paths.packagesRoot);

interface CategoryEntry {
    name: string;
    packageCount: number;
}

interface RootPackageJson {
    name?: string;
    description?: string;
}

function readRootPackageJson(): RootPackageJson {
    const raw = tryRead(join(ROOT, "package.json"));
    if (!raw) return {};
    try {
        return JSON.parse(raw) as RootPackageJson;
    } catch {
        return {};
    }
}

/**
 * A package's category is the immediate parent directory name of its dir
 * (`packages/<category>/<pkg>` → `<category>`); the flat-layout fallback
 * (`packages/<pkg>`) has no category folder and is bucketed separately.
 */
function categoryOf(pkgDir: string): string {
    const parent = dirname(pkgDir);
    return parent === PACKAGES_ROOT ? "uncategorized" : basename(parent);
}

async function collectCategories(): Promise<CategoryEntry[]> {
    if (!isDirectorySafe(PACKAGES_ROOT)) return [];
    const pkgDirs = await discoverPackageDirs();
    const counts = new Map<string, number>();
    for (const pkgDir of pkgDirs) {
        const name = categoryOf(pkgDir);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const out: CategoryEntry[] = [...counts.entries()].map(
        ([name, packageCount]) => ({ name, packageCount })
    );
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

function renderAutoBlock(categories: readonly CategoryEntry[]): string {
    if (categories.length === 0) {
        return [
            "## Packages by category",
            "",
            "No packages yet. Scaffold your first package under `packages/<category>/<pkg>/`, then run `bun scripts/docs/generate-all-docs.ts` to populate this section.",
        ].join("\n");
    }
    const totalPackages = categories.reduce(
        (acc, c) => acc + c.packageCount,
        0
    );
    const rows = categories
        .map((c) => {
            const link = `[\`${c.name}\`](./packages/${c.name}/README.md)`;
            return `| ${link} | ${c.packageCount} |`;
        })
        .join("\n");
    const lines = [
        "## Packages by category",
        "",
        `${totalPackages} package${totalPackages === 1 ? "" : "s"} across ${categories.length} categor${categories.length === 1 ? "y" : "ies"}. Each row links to the category's own README, which in turn lists every package and its first-paragraph description.`,
        "",
        "| Category | Packages |",
        "|---|---:|",
        rows,
    ];
    return lines.join("\n");
}

function defaultHeader(pkg: RootPackageJson): string {
    const name = pkg.name?.trim() || basename(ROOT) || "Monorepo";
    const description = pkg.description?.trim();
    const lines = [`# ${name}`, ""];
    if (description) lines.push(description, "");
    lines.push(
        "Bun + Turborepo + Biome monorepo template. Drop an `_intro.md` at the repo root to replace this default header.",
        "",
        "## Stack",
        "",
        "- **Monorepo orchestrator**: Turborepo",
        "- **Package manager / runtime**: Bun",
        "- **Lint / format**: Biome",
        "- **Unit tests**: Vitest",
        "- **E2E**: Playwright",
        "- **Language**: TypeScript (strict)",
        "",
        "## Workspace layout",
        "",
        "- [`apps/`](./apps/) — deployable applications.",
        "- [`packages/`](./packages/) — library packages, grouped by category (`packages/<category>/<pkg>/`).",
        "- [`e2e/`](./e2e/) — end-to-end test suites.",
        "",
        "## Companion docs",
        "",
        "- [`CLAUDE.md`](./CLAUDE.md) — engineering standards and AI-agent contract.",
        "- [`openspec/AGENTS.md`](./openspec/AGENTS.md) — the change-proposal workflow.",
        "- [`packages/README.md`](./packages/README.md) — auto-generated package index."
    );
    return lines.join("\n");
}

const AUTO_MARKER_BEGIN_TAG = "<!-- begin:auto-docs -->";
const AUTO_MARKER_END_TAG = "<!-- end:auto-docs -->";

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

    const intro = tryRead(INTRO_PATH);
    const header = intro?.trim()
        ? intro.trim()
        : defaultHeader(readRootPackageJson());
    const categories = await collectCategories();
    const auto = renderAutoBlock(categories);
    const next = `${header}\n\n${AUTO_MARKER_BEGIN_TAG}\n${auto}\n${AUTO_MARKER_END_TAG}\n`;

    let current = "";
    try {
        current = readFileSync(README_PATH, "utf-8");
    } catch {
        current = "";
    }

    if (current === next) {
        console.log(
            `✅ README.md already up to date (${categories.length} categories).`
        );
        process.exit(0);
    }

    if (options.check) {
        console.error(
            "❌ README.md is stale — run without --check to rewrite."
        );
        process.exit(1);
    }

    writeFileSync(README_PATH, next);
    console.log(`✏️  Wrote ${README_PATH} (${categories.length} categories).`);
}

void main();
