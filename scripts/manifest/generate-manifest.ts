#!/usr/bin/env bun
/**
 * Generates MANIFEST.md at repo root from on-disk
 * packages/<category>/<pkg>/package.json.
 *
 * Sections emitted:
 *   1. Packages table       — npm name | category | tier | version | workspace deps
 *   2. Tier overlay         — packages grouped by inferred tier
 *   3. Dependency graph     — DOT block for Graphviz
 *
 * Usage:
 *   bun scripts/manifest/generate-manifest.ts          # write MANIFEST.md
 *   bun scripts/manifest/generate-manifest.ts --check  # exit 1 if drift
 *   bun scripts/manifest/generate-manifest.ts --stdout # print only
 *
 * Tier inference priority (matches CLAUDE.md §16 "Code-tier organization" —
 * only three tiers are recognized in this project: universal / browser /
 * server; there is no separate react/r3f/python tier — React-peer packages
 * fall under "browser" since browser tier permits React/DOM):
 *   browser → server → universal
 *
 * Category is derived from a package's immediate parent directory name
 * under `packages/<category>/<pkg>/` — there is no mid-level
 * plugin/subcategory folder in this project's 2-level layout, so (unlike
 * the reference implementation this script was adapted from) there is no
 * separate "Plugins" table.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPackageDirs } from "../lib/discover-packages.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const manifestPath = join(repoRoot, "MANIFEST.md");

type Tier = "browser" | "server" | "universal";

interface PkgJson {
    name: string;
    version: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    browser?: unknown;
    bin?: unknown;
    engines?: Record<string, string>;
}

interface PkgRecord {
    name: string; // full package.json name (scoped or bare)
    short: string; // last path segment of name
    category: string; // immediate parent directory name under packages/
    dirName: string;
    version: string;
    description: string;
    tier: Tier;
    workspaceDeps: string[]; // sorted, dedup
}

const SERVER_DEP_HINTS = new Set([
    "bun:sqlite",
    "node:fs",
    "node:net",
    "node:cluster",
    "node:dgram",
    "node:tls",
    "node:dns",
    "node:child_process",
    "pg",
    "ioredis",
    "better-sqlite3",
]);

/** Last path segment of a package name — works for scoped and bare names. */
function shortName(name: string): string {
    const idx = name.lastIndexOf("/");
    return idx === -1 ? name : name.slice(idx + 1);
}

function readPkgJson(absDir: string): PkgJson | null {
    const f = join(absDir, "package.json");
    if (!existsSync(f)) return null;
    try {
        return JSON.parse(readFileSync(f, "utf8")) as PkgJson;
    } catch {
        return null;
    }
}

function inferTier(short: string, p: PkgJson): Tier {
    const peerKeys = Object.keys(p.peerDependencies ?? {});
    if (peerKeys.includes("react") || short.startsWith("react-")) {
        return "browser";
    }

    if (p.browser !== undefined) return "browser";
    const enginesKeys = Object.keys(p.engines ?? {});
    if (
        enginesKeys.length > 0 &&
        !enginesKeys.includes("node") &&
        !enginesKeys.includes("bun")
    )
        return "browser";

    if (p.bin !== undefined) return "server";
    const allDeps = { ...p.dependencies, ...p.devDependencies };
    for (const key of Object.keys(allDeps)) {
        if (SERVER_DEP_HINTS.has(key)) return "server";
    }

    return "universal";
}

function collectWorkspaceDeps(p: PkgJson): string[] {
    const out = new Set<string>();
    for (const map of [
        p.dependencies,
        p.peerDependencies,
        p.optionalDependencies,
    ]) {
        if (!map) continue;
        for (const [name, range] of Object.entries(map)) {
            if (typeof range === "string" && range.startsWith("workspace:")) {
                out.add(name);
            }
        }
    }
    return [...out].sort();
}

async function discoverPackages(): Promise<PkgRecord[]> {
    const pkgDirs = await discoverPackageDirs({ root: repoRoot });
    const records: PkgRecord[] = [];
    for (const pkgDir of pkgDirs) {
        const pj = readPkgJson(pkgDir);
        if (pj === null) continue;
        const short = shortName(pj.name);
        records.push({
            name: pj.name,
            short,
            category: basename(dirname(pkgDir)),
            dirName: basename(pkgDir),
            version: pj.version ?? "0.1.0",
            description: pj.description ?? "",
            tier: inferTier(short, pj),
            workspaceDeps: collectWorkspaceDeps(pj),
        });
    }
    records.sort((a, b) => a.name.localeCompare(b.name));
    return records;
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1).trimEnd()}…`;
}

function emitPackagesSection(records: PkgRecord[]): string {
    const lines: string[] = [];
    lines.push("## Packages");
    lines.push("");
    lines.push("| Package | Category | Tier | Version | Deps | Description |");
    lines.push("|---|---|---|---|---:|---|");
    for (const r of records) {
        lines.push(
            `| \`${r.name}\` | \`${r.category}\` | ${r.tier} | ${r.version} | ${r.workspaceDeps.length} | ${truncate(r.description, 80)} |`
        );
    }
    return lines.join("\n");
}

function emitTierOverlaySection(records: PkgRecord[]): string {
    const byTier = new Map<Tier, PkgRecord[]>();
    const tierOrder: Tier[] = ["universal", "browser", "server"];
    for (const t of tierOrder) byTier.set(t, []);
    for (const r of records) byTier.get(r.tier)?.push(r);

    const lines: string[] = [];
    lines.push("## Tier overlay");
    lines.push("");
    lines.push(
        "Tier is inferred per CLAUDE.md §16 priority order: browser → server → universal."
    );
    lines.push("");
    for (const tier of tierOrder) {
        const list = byTier.get(tier) ?? [];
        if (list.length === 0) continue;
        lines.push(`### ${tier} (${list.length})`);
        lines.push("");
        for (const r of list) lines.push(`- \`${r.name}\` (\`${r.category}\`)`);
        lines.push("");
    }
    return lines.join("\n").trimEnd();
}

function emitDependencyGraphSection(records: PkgRecord[]): string {
    const known = new Set(records.map((r) => r.name));
    const lines: string[] = [];
    lines.push("## Dependency graph");
    lines.push("");
    lines.push(
        "Workspace edges only. Pipe to Graphviz: `awk '/^```dot/,/^```$/' MANIFEST.md | sed '1d;$d' | dot -Tsvg > graph.svg`."
    );
    lines.push("");
    lines.push("```dot");
    lines.push("digraph workspace {");
    lines.push("  rankdir=LR;");
    lines.push('  node [shape=box, fontname="monospace", fontsize=10];');
    for (const r of records) {
        for (const dep of r.workspaceDeps) {
            if (!known.has(dep)) continue;
            lines.push(`  "${r.name}" -> "${dep}";`);
        }
    }
    lines.push("}");
    lines.push("```");
    return lines.join("\n");
}

function emitHeader(records: PkgRecord[]): string {
    const tierCounts = new Map<Tier, number>();
    for (const r of records)
        tierCounts.set(r.tier, (tierCounts.get(r.tier) ?? 0) + 1);
    const tiers = [...tierCounts.entries()]
        .map(([t, c]) => `${t}: ${c}`)
        .sort()
        .join(", ");
    const categories = new Set(records.map((r) => r.category)).size;

    const lines: string[] = [];
    lines.push("# Monorepo Manifest");
    lines.push("");
    lines.push(
        "> **Auto-generated by `scripts/manifest/generate-manifest.ts`. Do not edit by hand — run the script after package changes.**"
    );
    lines.push("");
    lines.push(
        `Packages: **${records.length}** across **${categories}** categories. Tiers: ${tiers || "—"}.`
    );
    return lines.join("\n");
}

function buildManifest(records: PkgRecord[]): string {
    if (records.length === 0) {
        return [
            "# Monorepo Manifest",
            "",
            "> **Auto-generated by `scripts/manifest/generate-manifest.ts`.**",
            "",
            "_No packages discovered under `packages/`. Scaffold your first package under `packages/<category>/<pkg>/` to populate this manifest._",
            "",
        ].join("\n");
    }
    const sections = [
        emitHeader(records),
        emitPackagesSection(records),
        emitTierOverlaySection(records),
        emitDependencyGraphSection(records),
    ];
    return `${sections.join("\n\n")}\n`;
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const checkMode = argv.includes("--check");
    const stdoutMode = argv.includes("--stdout");

    const records = await discoverPackages();
    const generated = buildManifest(records);

    if (stdoutMode) {
        process.stdout.write(generated);
        return;
    }

    if (checkMode) {
        const onDisk = existsSync(manifestPath)
            ? readFileSync(manifestPath, "utf8")
            : "";
        if (onDisk === generated) {
            console.log(
                `✓ MANIFEST.md is up to date (${records.length} packages).`
            );
            return;
        }
        console.error(
            "✗ MANIFEST.md is stale. Re-run: bun scripts/manifest/generate-manifest.ts"
        );
        process.exit(1);
    }

    writeFileSync(manifestPath, generated);
    console.log(
        `✓ Wrote ${manifestPath} (${records.length} packages, ${new Set(records.map((r) => r.category)).size} categories).`
    );
}

await main();
