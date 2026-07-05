#!/usr/bin/env bun
/**
 * Enforce §22 of `openspec/AGENTS.md`: an app change (a `proposal.md`
 * carrying `**App**: <name>` frontmatter) MUST include a `## Reusable
 * capability review` section, MUST NOT also carry `**Package**:`, and
 * every package cited in that section MUST already exist as a fully
 * shipped OpenSpec change — a folder under `openspec/archive/` whose
 * `proposal.md` carries `**Package**: <pkg>`.
 *
 * Usage:
 *   bun scripts/lint/check-app-extraction.ts
 *
 * Exit codes: 0 = no violations, 1 = at least one violation.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Glob } from "bun";

// See check-verified-by.ts for why `fileURLToPath(import.meta.url)` is used
// instead of Bun's `import.meta.dir` extension (portability under a
// bundler/transform layer such as vitest).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ProposalScan {
    readonly appName: string;
    readonly hasConflictingPackageField: boolean;
    readonly hasSection: boolean;
    readonly noneIdentified: boolean;
    readonly citedPackages: readonly string[];
}

const APP_FIELD_RE = /^\s*-?\s*\*\*App\*\*:\s*`?([^`\n]+?)`?\s*$/m;
const PACKAGE_FIELD_RE =
    /^\s*-?\s*\*\*Package\*\*:\s*`?(?:@[^/`]+\/)?([^`\n]+?)`?\s*$/m;

const SECTION_HEADING_RE = /^## Reusable capability review\s*$/m;
const NEXT_HEADING_RE = /^##[ \t]/m;
const NONE_IDENTIFIED_RE = /^.*None identified[ \t]*[-—][ \t]*\S.*$/m;
const PACKAGE_CITATION_LINE_RE =
    /^[ \t]*-[ \t]+`(?:@[a-z0-9-]+\/)?([a-z0-9-]+)`.*$/gm;

/**
 * Strip fenced (``` / ~~~) code blocks, HTML comments, and 4-space/tab
 * indented lines from markdown before scanning it for headings or
 * assertions. Otherwise a quoted example, a commented-out draft, or an
 * illustrative indented snippet can masquerade as real content. Pragmatic,
 * not a full CommonMark parser — see
 * docs/superpowers/specs/2026-07-05-app-package-extraction-design.md §2
 * for the adversarial cases this guards against, and its documented
 * residual limitations (unclosed fences, en-dash in None-identified).
 */
function stripCodeBlocks(md: string): string {
    let out = md
        .replace(/```[\s\S]*?```/g, "")
        .replace(/~~~[\s\S]*?~~~/g, "")
        .replace(/<!--[\s\S]*?-->/g, "");
    out = out.replace(/^(?: {4}|\t).*$(?:\n(?: {4}|\t).*$)*/gm, "");
    return out;
}

/**
 * Locate `## Reusable capability review` and return its body (everything
 * up to the next `## ` heading, or EOF), or `undefined` if no real heading
 * is found. The whole source is stripped BEFORE the heading search runs —
 * not just the text after wherever it first matches — so a decoy heading
 * quoted inside a fenced block or HTML comment earlier in the file can
 * never win the match.
 */
function extractSection(source: string): string | undefined {
    const stripped = stripCodeBlocks(source);
    const headingMatch = SECTION_HEADING_RE.exec(stripped);
    if (!headingMatch) return undefined;
    const afterHeading = stripped.slice(
        headingMatch.index + headingMatch[0].length
    );
    const nextHeading = NEXT_HEADING_RE.exec(afterHeading);
    return nextHeading
        ? afterHeading.slice(0, nextHeading.index)
        : afterHeading;
}

function extractCitations(body: string): string[] {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    PACKAGE_CITATION_LINE_RE.lastIndex = 0;
    while ((m = PACKAGE_CITATION_LINE_RE.exec(body)) !== null) {
        if (m[1]) out.push(m[1]);
    }
    return [...new Set(out)];
}

/**
 * Pure line-scan of one proposal.md (no file I/O). Returns `undefined` when
 * the proposal carries no `**App**:` frontmatter line — not an app
 * proposal, nothing to check.
 */
export function scanProposal(source: string): ProposalScan | undefined {
    const frontmatter = source.split("\n").slice(0, 30).join("\n");
    const appMatch = APP_FIELD_RE.exec(frontmatter);
    if (!appMatch?.[1]) return undefined;

    const hasConflictingPackageField = PACKAGE_FIELD_RE.test(frontmatter);
    const section = extractSection(source);
    if (section === undefined) {
        return {
            appName: appMatch[1],
            hasConflictingPackageField,
            hasSection: false,
            noneIdentified: false,
            citedPackages: [],
        };
    }

    return {
        appName: appMatch[1],
        hasConflictingPackageField,
        hasSection: true,
        noneIdentified: NONE_IDENTIFIED_RE.test(section),
        citedPackages: extractCitations(section),
    };
}
