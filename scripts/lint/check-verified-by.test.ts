/**
 * Unit test for check-verified-by.ts (the §20 Verified-by gate).
 *
 * Run with: `bun test scripts/lint/check-verified-by.test.ts`
 *
 * This imports the runner directly from `bun:test` rather than
 * `@suaveplan/testing/runner` — openspec/AGENTS.md §7 governs
 * `packages/<category>/<pkg>/src/**\/*.test.ts`, not root `scripts/`
 * tooling, which is outside the package workspace and exempt.
 *
 * The pure `scanSpec` core is exercised directly with inline spec-delta
 * fixtures; the file-I/O layer (`checkSpecFile`) and CLI (`main`) are covered
 * end-to-end by the gate run itself.
 */

import { describe, expect, it } from "bun:test";

import { scanSpec } from "./check-verified-by.ts";

const REL = "openspec/archive/2026-07-04-fixture/specs/cap/spec.md";

describe("check-verified-by / scanSpec", () => {
    it("flags an ADDED requirement with no Verified-by line", {
        timeout: 5000,
    }, () => {
        const source = [
            "## ADDED Requirements",
            "",
            "### Requirement: Does the thing",
            "",
            "The system SHALL do the thing.",
            "",
        ].join("\n");
        const { violations } = scanSpec(source, REL);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.reason).toContain(
            "lacks a **Verified by:** line"
        );
    });

    it('passes an ADDED requirement with a valid path::"title" citation', {
        timeout: 5000,
    }, () => {
        const source = [
            "## ADDED Requirements",
            "",
            "### Requirement: Does the thing",
            "",
            "The system SHALL do the thing.",
            '**Verified by:** `src/thing/thing.test.ts::"does the thing"`',
            "",
        ].join("\n");
        const { violations, archiveCites } = scanSpec(source, REL);
        expect(violations).toHaveLength(0);
        expect(archiveCites).toEqual([
            {
                line: 6,
                path: "src/thing/thing.test.ts",
                title: "does the thing",
            },
        ]);
    });

    it('flags a Verified-by line that cites a bare file with no ::"title"', {
        timeout: 5000,
    }, () => {
        const source = [
            "## ADDED Requirements",
            "",
            "### Requirement: Does the thing",
            "**Verified by:** `src/thing/thing.test.ts` AND `src/other/other.test.ts`",
            "",
        ].join("\n");
        const { violations } = scanSpec(source, REL);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.reason).toContain("lacks a parseable");
    });

    it("exempts a REMOVED requirement even with no Verified-by line", {
        timeout: 5000,
    }, () => {
        const source = [
            "## REMOVED Requirements",
            "",
            "### Requirement: Old Hono surface",
            "",
            "**Reason:** superseded by the Fetch-native redesign.",
            "**Migration:** `@template/api-plugin-kit`.",
            "",
        ].join("\n");
        const { violations } = scanSpec(source, REL);
        expect(violations).toHaveLength(0);
    });

    it("exempts a REMOVED requirement even if it carries a malformed Verified-by line", {
        timeout: 5000,
    }, () => {
        const source = [
            "## REMOVED Requirements",
            "",
            "### Requirement: Old surface",
            "**Verified by:** the old suite",
            "",
        ].join("\n");
        const { violations } = scanSpec(source, REL);
        expect(violations).toHaveLength(0);
    });

    it("resets the removed-section flag at the next section header", {
        timeout: 5000,
    }, () => {
        const source = [
            "## REMOVED Requirements",
            "",
            "### Requirement: Old surface",
            "**Reason:** gone.",
            "",
            "## ADDED Requirements",
            "",
            "### Requirement: New surface",
            "",
            "The system SHALL expose the new surface.",
            "",
        ].join("\n");
        const { violations } = scanSpec(source, REL);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.reason).toContain("New surface");
        expect(violations[0]?.reason).toContain(
            "lacks a **Verified by:** line"
        );
    });

    it("flags a MODIFIED requirement with no Verified-by (only REMOVED is exempt)", {
        timeout: 5000,
    }, () => {
        const source = [
            "## MODIFIED Requirements",
            "",
            "### Requirement: Changed behaviour",
            "",
            "The system SHALL do it differently.",
            "",
        ].join("\n");
        const { violations } = scanSpec(source, REL);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.reason).toContain(
            "lacks a **Verified by:** line"
        );
    });

    it("accepts a Verified by (gate) line naming a recognised mechanism", {
        timeout: 5000,
    }, () => {
        const source = [
            "## ADDED Requirements",
            "",
            "### Requirement: Browser-tier purity and subpath exports",
            "",
            "The package SHALL emit per-feature subpaths and import no `node:` builtins.",
            "**Verified by (gate):** `bunx turbo build` emits the dist subpaths AND `bunx turbo typecheck` proves no `node:` imports.",
            "",
        ].join("\n");
        const { violations, archiveCites } = scanSpec(source, REL);
        expect(violations).toHaveLength(0);
        // A (gate) line contributes no runtime-citation existence check.
        expect(archiveCites).toHaveLength(0);
    });

    it("accepts a Verified by (gate) line citing a coverage-config artifact", {
        timeout: 5000,
    }, () => {
        const source = [
            "## ADDED Requirements",
            "",
            "### Requirement: 100% coverage with no carve-outs",
            "**Verified by (gate):** the `vitest.config.ts` thresholds block enforces 100%.",
            "",
        ].join("\n");
        const { violations } = scanSpec(source, REL);
        expect(violations).toHaveLength(0);
    });

    it("flags a Verified by (gate) line that names no concrete mechanism", {
        timeout: 5000,
    }, () => {
        const source = [
            "## ADDED Requirements",
            "",
            "### Requirement: It is checked somehow",
            "**Verified by (gate):** the build gate handles this.",
            "",
        ].join("\n");
        const { violations } = scanSpec(source, REL);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.reason).toContain("recognised");
    });
});
