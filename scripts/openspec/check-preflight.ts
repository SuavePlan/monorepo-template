#!/usr/bin/env bun
/**
 * Fails if any unarchived openspec/changes/STAR/tasks.md is missing the
 * canonical pre-flight section (Section 0). Run from repo root.
 *
 * Exit codes: 0 = all clean, 1 = at least one tasks.md missing the section.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CHANGES_DIR = "openspec/changes";

const REQUIRED_LINE_PATTERNS: readonly RegExp[] = [
    /Pre-flight \(non-negotiable\)/,
    /git worktree list/,
    /\.claude\/worktrees/,
];

function findTasksMd(): readonly string[] {
    const entries: string[] = [];
    for (const name of readdirSync(CHANGES_DIR)) {
        const dir = join(CHANGES_DIR, name);
        if (!statSync(dir).isDirectory()) continue;
        const tasks = join(dir, "tasks.md");
        try {
            statSync(tasks);
            entries.push(tasks);
        } catch {
            // tasks.md may not exist for stub change folders; skip
        }
    }
    return entries;
}

function check(path: string): readonly string[] {
    const text = readFileSync(path, "utf8");
    const missing: string[] = [];
    for (const pattern of REQUIRED_LINE_PATTERNS) {
        if (!pattern.test(text)) missing.push(pattern.source);
    }
    return missing;
}

function main(): void {
    const tasksFiles = findTasksMd();
    let failed = 0;
    for (const file of tasksFiles) {
        const missing = check(file);
        if (missing.length > 0) {
            console.error(`FAIL ${file}`);
            for (const m of missing) {
                console.error(`    missing pattern /${m}/`);
            }
            failed++;
        }
    }
    if (failed > 0) {
        console.error(
            `\n${failed} of ${tasksFiles.length} unarchived change folders missing the pre-flight section.`
        );
        console.error(
            "Restore Section 0 (Pre-flight) from openspec/templates/tasks.md."
        );
        process.exit(1);
    }
    console.log(
        `OK ${tasksFiles.length} unarchived change folders carry the pre-flight section.`
    );
}

main();
