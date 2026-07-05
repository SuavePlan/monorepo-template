#!/usr/bin/env bun

/**
 * ensure-category-intros — writes a placeholder `_intro.md` for every
 * `packages/<category>/` folder that already contains at least one real
 * workspace package but lacks its own `_intro.md`. Existing files are never
 * overwritten.
 *
 * Genesis's equivalent (`ensure-category-subcategory-intros.ts`) ships a
 * fixed vocabulary of ~19 hand-written super-category descriptions plus a
 * parallel subcategory map. This template has neither: category names are
 * whatever the project defines as it grows, and there is no subcategory
 * tier at all. Placeholders here are therefore generic — hand-author real
 * copy once a category's purpose is settled.
 *
 * A category with no packages yet (e.g. the initial `packages/core/`
 * scaffold folder) is left alone: seeding an intro for a category that does
 * not exist yet just produces noise once real packages land elsewhere.
 *
 * Usage: bun scripts/docs/ensure-category-intros.ts
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../lib/config.js";
import { discoverPackageDirs } from "../lib/discover-packages.js";
import { isDirectorySafe } from "../lib/doc-tree.js";

const ROOT = CONFIG.paths.root;
const PACKAGES_ROOT = join(ROOT, CONFIG.paths.packagesRoot);

function defaultIntro(categoryName: string): string {
    return [
        `# \`${categoryName}\``,
        "",
        `Packages under \`packages/${categoryName}/\`. Replace this placeholder with a real description of what belongs in this category.`,
    ].join("\n");
}

function ensureIntro(path: string, content: string): boolean {
    if (existsSync(path)) return false;
    writeFileSync(path, `${content}\n`);
    return true;
}

async function main(): Promise<void> {
    if (!isDirectorySafe(PACKAGES_ROOT)) {
        console.error(`Packages root not found: ${PACKAGES_ROOT}`);
        process.exit(2);
    }

    let created = 0;
    let skipped = 0;
    let empty = 0;

    const catEntries = readdirSync(PACKAGES_ROOT, { withFileTypes: true });

    for (const cat of catEntries) {
        if (!cat.isDirectory() || cat.name.startsWith(".")) continue;
        const categoryDir = join(PACKAGES_ROOT, cat.name);

        const pkgDirs = await discoverPackageDirs({
            root: ROOT,
            packagesRoot: join(CONFIG.paths.packagesRoot, cat.name),
        });
        if (pkgDirs.length === 0) {
            empty++;
            continue;
        }

        const didCreate = ensureIntro(
            join(categoryDir, "_intro.md"),
            defaultIntro(cat.name)
        );
        didCreate ? created++ : skipped++;
    }

    console.log(`Created: ${created}`);
    console.log(`Skipped (already exist): ${skipped}`);
    console.log(`Empty (no packages yet): ${empty}`);
}

void main();
