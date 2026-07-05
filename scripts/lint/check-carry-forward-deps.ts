#!/usr/bin/env bun
/**
 * Enforce §18 of `openspec/AGENTS.md`: an open `[ ]` gate row in an
 * umbrella `tasks.md` MAY NOT carry-forward from another open `[ ]` gate.
 *
 * For every `openspec/changes/<umbrella>/tasks.md`, scan Section 2 rows
 * of the form `- [ ] 2.7 Stage 7 ✓ — ... carry forward from gate 2.X ...`
 * Build the dependency graph: row 2.Y depends on row 2.X (X less than Y).
 * Fail if any unchecked row depends on another unchecked row.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

// See check-verified-by.ts for why `fileURLToPath(import.meta.url)` is used
// instead of Bun's `import.meta.dir` extension (portability under a
// bundler/transform layer such as vitest).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface GateRow {
    readonly umbrella: string;
    readonly file: string;
    readonly line: number;
    readonly id: string;
    readonly checked: boolean;
    readonly carriesFrom: readonly string[];
}

const GATE_LINE_RE = /^- \[( |x)\] (2\.\d+)\b/i;
const CARRY_RE = /carry(?:ing|s)?\s+forward\s+from\s+(?:gate\s+)?(2\.\d+)/gi;

async function parseUmbrella(rel: string): Promise<GateRow[]> {
    const abs = resolve(REPO_ROOT, rel);
    const source = await readFile(abs, "utf8");
    const lines = source.split("\n");
    const rows: GateRow[] = [];
    let inSection2 = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (line.startsWith("## 2.")) inSection2 = true;
        else if (
            inSection2 &&
            line.startsWith("## ") &&
            !line.startsWith("## 2")
        )
            inSection2 = false;
        if (!inSection2) continue;
        const m = GATE_LINE_RE.exec(line);
        if (!m) continue;
        const [, mark, id] = m;
        if (id === undefined || mark === undefined) continue;
        const carriesFrom: string[] = [];
        for (let j = i; j < Math.min(i + 6, lines.length); j++) {
            const win = lines[j] ?? "";
            CARRY_RE.lastIndex = 0;
            for (
                let mm = CARRY_RE.exec(win);
                mm !== null;
                mm = CARRY_RE.exec(win)
            ) {
                if (mm[1] !== undefined && mm[1] !== id) {
                    carriesFrom.push(mm[1]);
                }
            }
        }
        rows.push({
            umbrella: rel.split("/")[2] ?? "?",
            file: rel,
            line: i + 1,
            id,
            checked: mark === "x" || mark === "X",
            carriesFrom,
        });
    }
    return rows;
}

async function main(): Promise<void> {
    const violations: string[] = [];
    const umbrellas: string[] = [];
    const g = new Glob("openspec/changes/*/tasks.md");
    for await (const f of g.scan({ cwd: REPO_ROOT })) {
        umbrellas.push(f);
    }
    const allRows: GateRow[] = [];
    for (const u of umbrellas) {
        allRows.push(...(await parseUmbrella(u)));
    }
    const byKey = new Map<string, GateRow>();
    for (const r of allRows) {
        byKey.set(`${r.umbrella}::${r.id}`, r);
    }
    for (const r of allRows) {
        if (r.checked) continue;
        for (const dep of r.carriesFrom) {
            const depRow = byKey.get(`${r.umbrella}::${dep}`);
            if (depRow === undefined) {
                violations.push(
                    `${r.file}:${r.line}  gate ${r.id} carries from ${dep} but ${dep} not found in same umbrella`
                );
                continue;
            }
            if (!depRow.checked) {
                violations.push(
                    `${r.file}:${r.line}  gate ${r.id} carries from ${dep} which is also unchecked — close ${dep} first`
                );
            }
        }
    }
    if (violations.length === 0) {
        console.log(
            `OK  ${allRows.length} umbrella gate rows scanned; no carry-forward-from-unshipped violations.`
        );
        return;
    }
    console.error(
        `FAIL  ${violations.length} carry-forward violation(s) - §18 forbids open-to-open carry:`
    );
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        "\nFix: close the earlier gate first (its row goes [x]), then unblock the dependent gate."
    );
    process.exit(1);
}

await main();
