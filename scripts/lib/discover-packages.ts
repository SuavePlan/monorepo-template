/**
 * Walk `packages/<category>/<pkg>/` and return absolute directory paths for
 * every workspace package (the level containing a `package.json`).
 *
 * Supports the canonical 2-level layout (`packages/<category>/<pkg>/`) and
 * falls back to flat (`packages/<pkg>/`) or a deeper 3-level
 * (`packages/<category>/<subcategory>/<pkg>/`) layout so experimental or
 * transitional packages keep working.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG } from "./config.js";

export interface DiscoverOptions {
    /** Override the monorepo root. Defaults to `CONFIG.paths.root`. */
    root?: string;
    /** Override the packages base. Defaults to `CONFIG.paths.packagesRoot`. */
    packagesRoot?: string;
}

async function hasPackageJson(dir: string): Promise<boolean> {
    try {
        await stat(join(dir, "package.json"));
        return true;
    } catch {
        return false;
    }
}

async function listDirs(parent: string): Promise<string[]> {
    const out: string[] = [];
    const entries = await readdir(parent).catch((): string[] => []);
    for (const name of entries) {
        const path = join(parent, name);
        const s = await stat(path).catch(() => null);
        if (s?.isDirectory()) out.push(path);
    }
    return out;
}

export async function discoverPackageDirs(
    options: DiscoverOptions = {}
): Promise<string[]> {
    const root = options.root ?? CONFIG.paths.root;
    const base = join(root, options.packagesRoot ?? CONFIG.paths.packagesRoot);

    const dirs: string[] = [];

    const level1 = await listDirs(base);
    for (const lvl1 of level1) {
        // Flat: packages/<pkg>/package.json
        if (await hasPackageJson(lvl1)) {
            dirs.push(lvl1);
            continue;
        }

        const level2 = await listDirs(lvl1);
        for (const lvl2 of level2) {
            // Canonical 2-level: packages/<category>/<pkg>/package.json
            if (await hasPackageJson(lvl2)) {
                dirs.push(lvl2);
                continue;
            }

            // Deeper 3-level: packages/<category>/<subcategory>/<pkg>/package.json
            const level3 = await listDirs(lvl2);
            for (const lvl3 of level3) {
                if (await hasPackageJson(lvl3)) {
                    dirs.push(lvl3);
                }
            }
        }
    }

    dirs.sort();
    return dirs;
}
