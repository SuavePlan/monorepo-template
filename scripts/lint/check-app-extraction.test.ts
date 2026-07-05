/**
 * Unit test for check-app-extraction.ts (the §22 app-package-extraction gate).
 *
 * Run with: `bun test scripts/lint/check-app-extraction.test.ts`
 *
 * This imports the runner directly from `bun:test` rather than
 * `@suaveplan/testing/runner` — openspec/AGENTS.md §7 governs
 * `packages/<category>/<pkg>/src/**\/*.test.ts`, not root `scripts/`
 * tooling, which is outside the package workspace and exempt.
 *
 * The pure `scanProposal` core is exercised directly with inline proposal.md
 * fixtures; the file-I/O layer (`main`) is exercised end-to-end by running
 * the gate for real (see Task 4 of the implementation plan / scripts/README.md).
 */

import { describe, expect, it } from "bun:test";

import { scanProposal } from "./check-app-extraction.ts";

describe("check-app-extraction / scanProposal", () => {
    it("returns undefined when the proposal carries no **App**: line", {
        timeout: 5000,
    }, () => {
        const source = [
            "**Package**: some-pkg",
            "",
            "## Why",
            "",
            "Some prose.",
            "",
        ].join("\n");
        expect(scanProposal(source)).toBeUndefined();
    });

    it("reports hasSection: false when the review section heading is missing", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Why",
            "",
            "Some prose.",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.appName).toBe("my-app");
        expect(scan?.hasSection).toBe(false);
    });

    it("flags a proposal that carries both **App**: and **Package**:", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "**Package**: my-app",
            "",
            "## Reusable capability review",
            "",
            "None identified — thin dashboard, nothing generalizable.",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.hasConflictingPackageField).toBe(true);
    });

    it("accepts a None identified line with a real same-line reason", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "None identified — this app has no generic technical capability; it's a thin dashboard over an existing API.",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.hasSection).toBe(true);
        expect(scan?.noneIdentified).toBe(true);
        expect(scan?.citedPackages).toEqual([]);
    });

    it("rejects a bare None identified line with no reason", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "None identified",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.noneIdentified).toBe(false);
        expect(scan?.citedPackages).toEqual([]);
    });

    it("ignores a None identified phrase that only appears inside a fenced code example", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "Here's an example of what NOT to write:",
            "",
            "```markdown",
            "None identified",
            "```",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.noneIdentified).toBe(false);
    });

    it("rejects a bare None identified followed by an unrelated bullet list", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "None identified",
            "",
            "- some unrelated bullet point",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.noneIdentified).toBe(false);
    });

    it("rejects a bare None identified followed by a --- separator rule", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "None identified",
            "",
            "---",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.noneIdentified).toBe(false);
    });

    it("captures backtick-fenced package names cited as bare bullet lines", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "- `retry-client`",
            "- `@suaveplan/http-cache`",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.citedPackages).toEqual(["retry-client", "http-cache"]);
    });

    it("captures a citation with trailing rationale text after the backtick", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "- `retry-client` — shared HTTP retry policy",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.citedPackages).toEqual(["retry-client"]);
    });

    it("does not miscapture an incidental tool-name mention inside a None identified reason", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "None identified — reviewed via the `pkg-new` skill; we also checked whether `bun` itself needed wrapping.",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.noneIdentified).toBe(true);
        expect(scan?.citedPackages).toEqual([]);
    });

    it("reaches real content after a fenced example inside the section that embeds a ## line", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "```markdown",
            "## fenced heading, not real",
            "None identified",
            "```",
            "",
            "None identified — real reason here, after the fence.",
            "",
            "## Next section",
            "irrelevant",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.hasSection).toBe(true);
        expect(scan?.noneIdentified).toBe(true);
    });

    it("finds the real section instead of a decoy heading quoted in an earlier fenced block", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Background",
            "",
            "For reviewer context, here's the rule text this proposal follows:",
            "",
            "```markdown",
            "## Reusable capability review",
            "",
            "- `decoy-pkg`",
            "```",
            "",
            "## Reusable capability review",
            "",
            "None identified — this app has no generic technical capability.",
            "",
            "## Next section",
            "irrelevant",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.noneIdentified).toBe(true);
        expect(scan?.citedPackages).toEqual([]);
    });

    it("reports hasSection: false when only a decoy heading exists, inside a fence", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "```markdown",
            "## Reusable capability review",
            "- `decoy-pkg`",
            "```",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.hasSection).toBe(false);
    });

    it("finds the real section instead of a decoy heading quoted in an earlier HTML comment", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "<!--",
            "## Reusable capability review",
            "- `decoy-pkg`",
            "-->",
            "",
            "## Reusable capability review",
            "",
            "None identified — this app has no generic technical capability.",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.noneIdentified).toBe(true);
        expect(scan?.citedPackages).toEqual([]);
    });

    it("doesn't truncate the section early on a commented-out draft heading inside it", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "<!-- ## some draft heading, commented out -->",
            "",
            "None identified — real reason here.",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.noneIdentified).toBe(true);
    });

    it("does not leak a citation-shaped line from a 4-space-indented illustrative example", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "None identified — this app has no generic technical capability.",
            "",
            "Example of what not to write:",
            "",
            "    - `example-pkg` — illustration only",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.citedPackages).toEqual([]);
    });

    it("reports the violation shape when the section has neither a valid reason nor any citation", {
        timeout: 5000,
    }, () => {
        const source = [
            "**App**: my-app",
            "",
            "## Reusable capability review",
            "",
            "We haven't decided yet.",
        ].join("\n");
        const scan = scanProposal(source);
        expect(scan?.hasSection).toBe(true);
        expect(scan?.noneIdentified).toBe(false);
        expect(scan?.citedPackages).toEqual([]);
    });
});
