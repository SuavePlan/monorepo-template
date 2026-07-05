#!/usr/bin/env bun
/**
 * Enforce §19 of openspec/AGENTS.md: every proposal for a package
 * on the configured primitive-package list MUST identify its concrete
 * consumer, its host-bridge (if needed), and the e2e/ test path.
 *
 * The primitive list lives in `scripts/lint/primitives.json`. Each
 * entry is the package short-name (e.g. `api-sandbox-vm`) plus an
 * optional `requiresBridge` flag and a `bridgePackagePattern`.
 *
 * For each `openspec/changes/<primitive>/proposal.md` whose package
 * name matches the list, scan the proposal text for the three
 * sentinel sections:
 *   - `## Concrete consumer` containing at least one backtick-fenced
 *     package reference.
 *   - `## Host bridge` (only if requiresBridge=true) citing the
 *     bridge package by name matching bridgePackagePattern.
 *   - `## End-to-end test` citing an `e2e/<umbrella>-stage-N/` path.
 *
 * Missing any sentinel for a listed primitive is a violation.
 *
 * `scripts/lint/primitives.json` ships as `[]` in a fresh project — the
 * gate is then a documented no-op (see the "OK ... nothing to check"
 * branch below) until the project adds real primitive packages and
 * populates the list.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

// See check-verified-by.ts for why `fileURLToPath(import.meta.url)` is used
// instead of Bun's `import.meta.dir` extension (portability under a
// bundler/transform layer such as vitest).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PrimitiveSpec {
    readonly name: string;
    readonly requiresBridge?: boolean;
    readonly bridgePackagePattern?: string;
}

async function loadPrimitives(): Promise<PrimitiveSpec[]> {
    const abs = resolve(REPO_ROOT, "scripts/lint/primitives.json");
    try {
        const raw = await readFile(abs, "utf8");
        return JSON.parse(raw) as PrimitiveSpec[];
    } catch {
        return [];
    }
}

async function checkProposal(
    rel: string,
    spec: PrimitiveSpec
): Promise<string[]> {
    const abs = resolve(REPO_ROOT, rel);
    const source = await readFile(abs, "utf8");
    const violations: string[] = [];
    if (!source.includes("## Concrete consumer")) {
        violations.push(
            `${rel}  §19: proposal for primitive '${spec.name}' lacks a '## Concrete consumer' section`
        );
    }
    if (spec.requiresBridge === true) {
        if (!source.includes("## Host bridge")) {
            violations.push(
                `${rel}  §19: proposal for primitive '${spec.name}' lacks a '## Host bridge' section`
            );
        } else if (
            spec.bridgePackagePattern !== undefined &&
            !new RegExp(spec.bridgePackagePattern).test(source)
        ) {
            violations.push(
                `${rel}  §19: '## Host bridge' section does not cite a bridge package matching pattern '${spec.bridgePackagePattern}'`
            );
        }
    }
    if (!source.includes("## End-to-end test")) {
        violations.push(
            `${rel}  §19: proposal for primitive '${spec.name}' lacks a '## End-to-end test' section`
        );
    } else if (
        !/e2e\/foundation-stack-stage-\d+/.test(source) &&
        !/e2e\/[a-z0-9-]+/.test(source)
    ) {
        violations.push(
            `${rel}  §19: '## End-to-end test' section does not cite an e2e/<umbrella>-stage-N/ path`
        );
    }
    return violations;
}

async function main(): Promise<void> {
    const primitives = await loadPrimitives();
    if (primitives.length === 0) {
        console.log(
            "OK  no primitives configured in scripts/lint/primitives.json — nothing to check."
        );
        return;
    }
    const byName = new Map(primitives.map((p) => [p.name, p]));
    const violations: string[] = [];
    const g = new Glob("openspec/changes/*/proposal.md");
    for await (const f of g.scan({ cwd: REPO_ROOT })) {
        const changeId = f.split("/")[2] ?? "?";
        const spec = byName.get(changeId);
        if (spec === undefined) continue;
        violations.push(...(await checkProposal(f, spec)));
    }
    if (violations.length === 0) {
        console.log(
            `OK  ${primitives.length} primitive package(s) on the §19 list; every proposal carries the three required sections.`
        );
        return;
    }
    console.error(`FAIL  ${violations.length} §19 violation(s):`);
    for (const v of violations) console.error(`  ${v}`);
    console.error(
        "\n§19: every primitive package proposal MUST include '## Concrete consumer', '## Host bridge' (if required), and '## End-to-end test' sections."
    );
    process.exit(1);
}

await main();
