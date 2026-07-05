/**
 * Unit test for check-test-runner-imports.ts.
 *
 * Run with: `bun test scripts/lint/check-test-runner-imports.test.ts`
 *
 * Uses Bun's native test runner because this file is repo tooling, not a
 * workspace package — the canonical-runner-wrapper rule (openspec/AGENTS.md
 * §7) governs `packages/<category>/<pkg>/src/**\/*.test.ts`, not `scripts/`.
 * Importing the rule-enforcer's own test from the project's test wrapper
 * would create a circular dependency between the gate and the wrapper it
 * polices (and no such wrapper package exists yet in this fresh repo).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    findViolations,
    formatViolations,
} from "./check-test-runner-imports.ts";

interface Fixture {
    readonly root: string;
    cleanup(): Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
    const root = await mkdtemp(join(tmpdir(), "check-runner-imports-"));
    return {
        root,
        async cleanup() {
            await rm(root, { recursive: true, force: true });
        },
    };
}

/**
 * Writes a package at the canonical 2-level layout this repo's
 * `discoverPackageDirs()` expects: `packages/<category>/<pkg>/`.
 */
async function writePackage(args: {
    root: string;
    category: string;
    pkg: string;
    name: string;
    files: Record<string, string>;
}): Promise<void> {
    const pkgDir = join(args.root, "packages", args.category, args.pkg);
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: args.name })
    );
    for (const [relPath, content] of Object.entries(args.files)) {
        const full = join(pkgDir, relPath);
        await mkdir(join(full, ".."), { recursive: true });
        await writeFile(full, content);
    }
}

describe("check-test-runner-imports", () => {
    let fixture: Fixture;

    beforeEach(async () => {
        fixture = await makeFixture();
    });

    afterEach(async () => {
        await fixture.cleanup();
    });

    it("reports zero violations when every package uses the runner-neutral wrapper", {
        timeout: 5000,
    }, async () => {
        await writePackage({
            root: fixture.root,
            category: "core",
            pkg: "good-pkg",
            name: "good-pkg",
            files: {
                "src/feature/feature.test.ts":
                    'import { describe, it, expect } from "../../testing/runner";\n' +
                    'describe("ok", () => { it("passes", () => { expect(1).toBe(1); }); });\n',
            },
        });
        const violations = await findViolations({ repoRoot: fixture.root });
        expect(violations).toEqual([]);
        expect(formatViolations(violations)).toContain(
            "All non-exempt packages use the project's runner-neutral test wrapper."
        );
    });

    it("flags a direct vitest import in a non-exempt package", {
        timeout: 5000,
    }, async () => {
        await writePackage({
            root: fixture.root,
            category: "core",
            pkg: "bad-pkg",
            name: "bad-pkg",
            files: {
                "src/feature/feature.test.ts":
                    'import { describe, it, expect } from "vitest";\n',
            },
        });
        const violations = await findViolations({ repoRoot: fixture.root });
        expect(violations).toHaveLength(1);
        expect(violations[0]?.packageName).toBe("bad-pkg");
        expect(violations[0]?.file).toBe(
            "packages/core/bad-pkg/src/feature/feature.test.ts"
        );
        expect(violations[0]?.line).toBe(1);
        expect(violations[0]?.source).toContain('from "vitest"');

        const message = formatViolations(violations);
        expect(message).toContain("❌ Direct vitest / bun:test imports");
        expect(message).toContain("bad-pkg");
        expect(message).toContain("openspec/AGENTS.md §7");
    });

    it("flags a direct bun:test import in a non-exempt package", {
        timeout: 5000,
    }, async () => {
        await writePackage({
            root: fixture.root,
            category: "core",
            pkg: "bad-bun",
            name: "bad-bun",
            files: {
                "src/x.test.ts": "import { describe } from 'bun:test';\n",
            },
        });
        const violations = await findViolations({ repoRoot: fixture.root });
        expect(violations).toHaveLength(1);
        expect(violations[0]?.source).toContain("'bun:test'");
    });

    it("skips packages listed in the exempt-packages override", {
        timeout: 5000,
    }, async () => {
        await writePackage({
            root: fixture.root,
            category: "core",
            pkg: "testing-wrapper",
            name: "testing-wrapper",
            files: {
                "src/x.test.ts":
                    'import { describe, it, expect } from "vitest";\n' +
                    "import { describe as bunDescribe } from 'bun:test';\n",
            },
        });
        const violations = await findViolations({
            repoRoot: fixture.root,
            exemptPackages: ["testing-wrapper"],
        });
        expect(violations).toEqual([]);
    });

    it("falls back to CONFIG.testing.exemptRunnerWrapperPackages when no override is given", {
        timeout: 5000,
    }, async () => {
        await writePackage({
            root: fixture.root,
            category: "core",
            pkg: "unlisted-pkg",
            name: "unlisted-pkg",
            files: {
                "src/x.test.ts": 'import { it } from "vitest";\n',
            },
        });
        // CONFIG.testing.exemptRunnerWrapperPackages is empty in this
        // project (no testing-wrapper package exists yet), so every
        // package — including this one — is subject to the rule.
        const violations = await findViolations({ repoRoot: fixture.root });
        expect(violations).toHaveLength(1);
    });

    it("ignores packages without a src/ directory", {
        timeout: 5000,
    }, async () => {
        await writePackage({
            root: fixture.root,
            category: "core",
            pkg: "no-src",
            name: "no-src",
            files: {
                "README.md": "# no src here\n",
            },
        });
        const violations = await findViolations({ repoRoot: fixture.root });
        expect(violations).toEqual([]);
    });

    it("does not flag re-exports from a barrel (only `import` statements)", {
        timeout: 5000,
    }, async () => {
        await writePackage({
            root: fixture.root,
            category: "core",
            pkg: "reexport",
            name: "reexport",
            files: {
                "src/x.ts": 'export { describe } from "vitest";\n',
            },
        });
        const violations = await findViolations({ repoRoot: fixture.root });
        // The rule scope is `import` statements; re-exports from vitest
        // in non-test code are caught by other rules (and are
        // nonsensical for a non-exempt package — they would mean
        // shipping vitest at runtime). The check stays
        // import-statement-scoped to keep the signal high.
        expect(violations).toEqual([]);
    });

    it("ignores directories with no package.json at any level", {
        timeout: 5000,
    }, async () => {
        const pkgDir = join(fixture.root, "packages", "core", "no-manifest");
        await mkdir(join(pkgDir, "src"), { recursive: true });
        await writeFile(
            join(pkgDir, "src", "x.test.ts"),
            'import { describe } from "vitest";\n'
        );
        // discoverPackageDirs() only returns directories that actually
        // contain a package.json, so a directory tree with none is
        // never scanned in the first place.
        const violations = await findViolations({ repoRoot: fixture.root });
        expect(violations).toEqual([]);
    });

    it("scans .tsx as well as .ts", { timeout: 5000 }, async () => {
        await writePackage({
            root: fixture.root,
            category: "core",
            pkg: "tsx-pkg",
            name: "tsx-pkg",
            files: {
                "src/x.test.tsx": 'import { describe } from "vitest";\n',
            },
        });
        const violations = await findViolations({ repoRoot: fixture.root });
        expect(violations).toHaveLength(1);
        expect(violations[0]?.file).toEndWith(".tsx");
    });

    it("throws when a discovered package.json is unparsable", {
        timeout: 5000,
    }, async () => {
        const pkgDir = join(fixture.root, "packages", "core", "broken-json");
        await mkdir(pkgDir, { recursive: true });
        await writeFile(join(pkgDir, "package.json"), "{ not valid json");
        await expect(
            findViolations({ repoRoot: fixture.root })
        ).rejects.toThrow(/Cannot parse/);
    });
});
