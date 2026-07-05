#!/usr/bin/env bun
/**
 * Enforce §18 of openspec/AGENTS.md: every Stage block in an umbrella
 * tasks.md MUST list a `N.0 e2e/<umbrella>-stage-N/` closure-smoke row
 * alongside the stage's per-package rows.
 *
 * No grandfather clause and no hardcoded package exemption: unlike the
 * reference implementation this was ported from, this project has zero
 * pre-existing umbrella changes to exempt — §18 applies to every umbrella
 * from day one. If a future rule change needs a cutover mechanism, add one
 * deliberately (with its own effective-date constant) rather than reviving
 * this one unused. See check-verified-by.ts for the matching decision on
 * that gate.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

// See check-verified-by.ts for why `fileURLToPath(import.meta.url)` is used
// instead of Bun's `import.meta.dir` extension (portability under a
// bundler/transform layer such as vitest).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface StageBlock {
    readonly umbrella: string;
    readonly file: string;
    readonly stageId: number;
    readonly stageHeadingLine: number;
    readonly hasSmokeRow: boolean;
}

const STAGE_HEADING_RE = /^### Stage (\d+)\b/;
const PACKAGE_ROW_RE = /^- \[( |x)\]\s+(\d+)\.(\d+)\s+/i;

async function parseUmbrella(rel: string): Promise<StageBlock[]> {
    const abs = resolve(REPO_ROOT, rel);
    const source = await readFile(abs, "utf8");
    const lines = source.split("\n");
    const umbrellaName = rel.split("/")[2] ?? "?";
    const blocks: StageBlock[] = [];
    let inSection1 = false;
    let currentStage: number | undefined;
    let currentStageLine = 0;
    let currentHasSmoke = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (/^## 1\b/.test(line)) {
            inSection1 = true;
            continue;
        }
        if (inSection1 && /^## /.test(line)) {
            if (currentStage !== undefined) {
                blocks.push({
                    umbrella: umbrellaName,
                    file: rel,
                    stageId: currentStage,
                    stageHeadingLine: currentStageLine,
                    hasSmokeRow: currentHasSmoke,
                });
                currentStage = undefined;
            }
            inSection1 = false;
            continue;
        }
        if (!inSection1) continue;
        const sh = STAGE_HEADING_RE.exec(line);
        if (sh !== null) {
            if (currentStage !== undefined) {
                blocks.push({
                    umbrella: umbrellaName,
                    file: rel,
                    stageId: currentStage,
                    stageHeadingLine: currentStageLine,
                    hasSmokeRow: currentHasSmoke,
                });
            }
            currentStage = Number.parseInt(sh[1] ?? "0", 10);
            currentStageLine = i + 1;
            currentHasSmoke = false;
            continue;
        }
        const pr = PACKAGE_ROW_RE.exec(line);
        if (pr !== null) {
            const [, , majorStr, minorStr] = pr;
            if (minorStr === "0" && majorStr !== undefined) {
                if (line.includes("e2e/") && line.includes("stage-")) {
                    currentHasSmoke = true;
                }
            }
        }
    }
    if (currentStage !== undefined) {
        blocks.push({
            umbrella: umbrellaName,
            file: rel,
            stageId: currentStage,
            stageHeadingLine: currentStageLine,
            hasSmokeRow: currentHasSmoke,
        });
    }
    return blocks;
}

async function main(): Promise<void> {
    const violations: string[] = [];
    const g = new Glob("openspec/changes/*/tasks.md");
    for await (const f of g.scan({ cwd: REPO_ROOT })) {
        const blocks = await parseUmbrella(f);
        for (const b of blocks) {
            if (!b.hasSmokeRow) {
                violations.push(
                    `${b.file}:${b.stageHeadingLine}  Stage ${b.stageId} lacks an N.0 e2e/${b.umbrella}-stage-${b.stageId}/ closure-smoke row`
                );
            }
        }
    }
    if (violations.length === 0) {
        console.log("OK  every Stage-N block lists its closure-smoke row.");
        return;
    }
    console.error(
        `FAIL  ${violations.length} stage block(s) missing closure-smoke row:`
    );
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        "\n§18: every Stage N block MUST include - [ ] N.0 e2e/<umbrella>-stage-N/ alongside its package rows."
    );
    process.exit(1);
}

await main();
