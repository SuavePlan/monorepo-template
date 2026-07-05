/**
 * Unit tests for doc-tree.ts auto-docs marker handling. Run with `bun test`.
 *
 * Repo tooling, not a workspace package — uses Bun's native runner directly
 * (the @suaveplan/testing/runner rule governs packages/, not scripts/).
 *
 * Regression coverage for the monorepo-wide `.md` flip-flop: a prior corrupted
 * generator run leaked tree entries past `<!-- end:auto-docs -->` (glued onto
 * the marker line and duplicated below it). `replaceMarkedSection` must strip
 * that leaked trailer rather than preserve and re-truncate it on every run.
 */

import { describe, expect, it } from "bun:test";
import { firstBodyParagraph, replaceMarkedSection } from "./doc-tree.ts";

const BODY = `## Submodules

- [helpers](./helpers.md) — Low-level byte-inspection utilities
- [registry](./registry.md) — The mutable signature registry`;

describe("replaceMarkedSection — leaked-trailer cleanup", () => {
    it("strips entries glued onto and duplicated after the end marker", () => {
        const corrupt = [
            "# x",
            "",
            "<!-- begin:auto-docs -->",
            "## Submodules",
            "",
            "- [helpers](./helpers.md) — Low-level byte-inspection utilities",
            "- [registry](./registry.md) — The mutable signature registry",
            "<!-- end:auto-docs --> - helpers — Low-level utilities used……",
            "",
            "- [helpers](./helpers.md) — Low-level byte-inspection utilities",
            "- [registry](./registry.md) — The mutable signature registry",
            "",
            "## Purpose",
            "",
            "Prose.",
            "",
        ].join("\n");
        const { next, changed } = replaceMarkedSection(corrupt, BODY);
        expect(changed).toBe(true);
        // Exactly one end marker, nothing glued onto its line.
        expect(next.match(/<!-- end:auto-docs -->/g)?.length).toBe(1);
        expect(/<!-- end:auto-docs -->[^\n]/.test(next)).toBe(false);
        // No leaked tree entries survive after the marker.
        const trailer = next.split("<!-- end:auto-docs -->")[1] ?? "";
        expect(trailer.includes("- [helpers]")).toBe(false);
        // Real content is preserved.
        expect(next.includes("## Purpose")).toBe(true);
        expect(next.includes("Prose.")).toBe(true);
    });

    it("is idempotent on its own cleaned output", () => {
        const corrupt =
            "# x\n\n<!-- begin:auto-docs -->\n## Submodules\n\n- [a](./a.md) — t\n<!-- end:auto-docs --> - a — t…\n\n## Purpose\n";
        const once = replaceMarkedSection(
            corrupt,
            "## Submodules\n\n- [a](./a.md) — t"
        ).next;
        const twice = replaceMarkedSection(
            once,
            "## Submodules\n\n- [a](./a.md) — t"
        );
        expect(twice.changed).toBe(false);
    });

    it("leaves an already-clean block byte-identical", () => {
        const clean =
            "# x\n\n<!-- begin:auto-docs -->\n## Submodules\n\n- [a](./a.md) — t\n<!-- end:auto-docs -->\n\n## Purpose\n\nProse.\n";
        const { changed } = replaceMarkedSection(
            clean,
            "## Submodules\n\n- [a](./a.md) — t"
        );
        expect(changed).toBe(false);
    });

    it("strips degraded plain-text leaked bullets (no link)", () => {
        const corrupt =
            "# x\n\n<!-- begin:auto-docs -->\n## Submodules\n\n- [a](./a.md) — t\n<!-- end:auto-docs -->\n- a.schema — Zod schema for `Foo…\n- a.schema — Zod schema for `Foo…\n\n## Purpose\n\nProse.\n";
        const { next } = replaceMarkedSection(
            corrupt,
            "## Submodules\n\n- [a](./a.md) — t"
        );
        const trailer = next.split("<!-- end:auto-docs -->")[1] ?? "";
        expect(trailer.includes("a.schema")).toBe(false);
        expect(next.includes("## Purpose")).toBe(true);
    });
});

describe("firstBodyParagraph — markdownlint-safe summaries", () => {
    it("never leaves an unbalanced trailing backtick after truncation", () => {
        const long = `prose ${"x".repeat(100)} for \`CompressedBitPackerOptions\` and more`;
        const summary = firstBodyParagraph(`# Title\n\n${long}\n`, 120);
        expect((summary.match(/`/g) ?? []).length % 2).toBe(0);
        expect(summary.endsWith("…")).toBe(true);
    });

    it("skips leading bullet lines and auto-docs blocks to reach prose", () => {
        const doc =
            "# Title\n\n<!-- begin:auto-docs -->\n## Submodules\n\n- [a](./a.md) — t\n<!-- end:auto-docs -->\n\n## Purpose\n\nThe real description prose.\n";
        expect(firstBodyParagraph(doc)).toBe("The real description prose.");
    });
});
