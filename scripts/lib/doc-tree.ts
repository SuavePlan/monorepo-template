/**
 * Shared helpers for the documentation-tree scripts:
 *   - `firstBodyParagraph` — extract a truncated first paragraph from a `.md`.
 *   - `walkMd` — recursive `.md` walker honoring an ignore list.
 *   - `replaceMarkedSection` — idempotent in-place section replacement.
 *   - `extractRelativeMdLinks` — pull `.md` link targets out of markdown content.
 *   - `findCanonicalMd` — locate the dominant `.md` for a directory.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const AUTO_MARKER_BEGIN = "<!-- begin:auto-docs -->";
export const AUTO_MARKER_END = "<!-- end:auto-docs -->";

/**
 * Strip a leading `# Header` line and any frontmatter, then return the first
 * non-empty paragraph (text up to the next blank line). Inline markdown
 * formatting is preserved; whitespace is collapsed; the result is truncated
 * to `maxChars` characters (with a trailing ellipsis when it overflows).
 */
export function firstBodyParagraph(content: string, maxChars = 120): string {
    // Strip auto-docs blocks before extracting prose — they can land before
    // ## Purpose when first inserted, which would be picked up as the description.
    let body = content
        .replace(/^﻿/, "")
        .replace(
            /<!--\s*begin:auto-docs\s*-->[\s\S]*?<!--\s*end:auto-docs\s*-->/g,
            ""
        );
    if (body.startsWith("---\n")) {
        const end = body.indexOf("\n---", 4);
        if (end !== -1) body = body.slice(end + 4);
    }
    const lines = body.split("\n");
    let i = 0;
    // Skip leading whitespace + every heading line so the first prose
    // paragraph is grabbed regardless of whether the doc starts with
    // `# Title\n## Purpose\n\nprose…` or `# Title\n\nprose…`.
    const isHeading = (line: string): boolean => /^#{1,6}\s/.test(line);
    while (i < lines.length) {
        const line = (lines[i] ?? "").trim();
        if (line === "") {
            i++;
            continue;
        }
        if (isHeading(lines[i] ?? "")) {
            i++;
            continue;
        }
        // Skip leading bullet lines: a description is display prose, never a
        // list, and a leading bullet here is usually leaked auto-docs debris.
        if (/^[-*]\s/.test(line)) {
            i++;
            continue;
        }
        break;
    }
    const paragraph: string[] = [];
    while (i < lines.length) {
        const line = lines[i] ?? "";
        if (line.trim() === "") break;
        if (/^(#{1,6}\s|```|---|>\s)/.test(line)) break;
        paragraph.push(line);
        i++;
    }
    // Strip inline markdown link syntax — `[text](url)` becomes `text` —
    // so the truncation can never land inside a URL or break MDX autolink
    // parsing downstream. Bare `<https://...>` autolinks are stripped to
    // their text form too. Descriptions are display-only; the clickable
    // links live elsewhere in the doc tree.
    const stripped = paragraph
        .join(" ")
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
        .replace(/<(https?:\/\/[^>]+)>/gu, "$1")
        .replace(/\s+/g, " ")
        .trim();
    if (!stripped) return "";
    if (stripped.length <= maxChars) return stripped;
    let cut = stripped.slice(0, maxChars - 1).trimEnd();
    // Belt-and-braces: if anything URL-shaped still extends past the cut,
    // walk back to the last whitespace before it so the truncated string
    // never trails a partial URL.
    const lastHttpIdx = Math.max(
        cut.lastIndexOf("https://"),
        cut.lastIndexOf("http://")
    );
    if (lastHttpIdx >= 0 && !/\s/.test(cut.slice(lastHttpIdx))) {
        cut = cut.slice(0, lastHttpIdx).trimEnd();
    }
    // Drop a dangling, unclosed inline-code span left by the cut so the summary
    // never trails an unbalanced backtick. Otherwise markdownlint's MD038
    // ("no spaces inside code spans") rewrites `for \`Foo…` → `for\`Foo…`,
    // fighting the generator on every run — the monorepo `.md` flip-flop.
    if (((cut.match(/`/g) ?? []).length & 1) === 1) {
        cut = cut.slice(0, cut.lastIndexOf("`")).trimEnd();
    }
    return `${cut}…`;
}

export interface WalkOptions {
    /** Directory names (segments) to skip entirely. */
    ignoreDirs?: readonly string[];
    /** File names to skip. */
    ignoreFiles?: readonly string[];
    /** Path segments — if any segment matches, the file is skipped. */
    ignoreSegments?: readonly string[];
}

const DEFAULT_IGNORE_DIRS: readonly string[] = [
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".vite",
    ".next",
];

export function walkMd(root: string, options: WalkOptions = {}): string[] {
    const ignoreDirs = new Set([
        ...DEFAULT_IGNORE_DIRS,
        ...(options.ignoreDirs ?? []),
    ]);
    const ignoreFiles = new Set(options.ignoreFiles ?? []);
    const ignoreSegments = options.ignoreSegments ?? [];
    const out: string[] = [];
    const stack: string[] = [root];
    while (stack.length > 0) {
        const dir = stack.pop() as string;
        let entries: ReturnType<typeof readdirSync>;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const name = entry.name;
            const full = join(dir, name);
            if (entry.isDirectory()) {
                if (ignoreDirs.has(name)) continue;
                if (name.startsWith(".") && name !== ".") continue;
                if (ignoreSegments.some((s) => full.includes(`${s}/`)))
                    continue;
                stack.push(full);
            } else if (entry.isFile()) {
                if (!name.endsWith(".md")) continue;
                if (ignoreFiles.has(name)) continue;
                if (ignoreSegments.some((s) => full.includes(`${s}/`)))
                    continue;
                out.push(full);
            }
        }
    }
    out.sort();
    return out;
}

/**
 * Find `<!-- begin:auto-docs -->...<!-- end:auto-docs -->` in `content` and
 * replace the body between the markers with `replacement`. If markers are
 * absent, the markered block is inserted before the first `## ` heading
 * (so the autotable sits above hand-authored sections) or appended at the
 * end of the file when no heading is found. Returns `{ next, changed }`.
 */
/**
 * Strip leaked auto-docs content that a prior corrupted generator run appended
 * AFTER the closing `<!-- end:auto-docs -->` marker: text glued onto the marker
 * line, plus duplicated tree-entry bullets, stray markers, truncated `<!-- en…`
 * fragments, and the blank lines between them — up to the document's first line
 * of real content. Without this, the corruption is preserved verbatim and grows
 * on every run (re-truncated summaries gain another `…`), which is the
 * package-`.md` flip-flop seen across the monorepo.
 */
function stripLeakedTrailer(afterMarker: string): string {
    // Drop the remainder of the end-marker's own line: a clean file has only a
    // newline here; a corrupted file has a glued tree entry.
    const firstNewline = afterMarker.indexOf("\n");
    const rest = firstNewline === -1 ? "" : afterMarker.slice(firstNewline + 1);
    const isLeaked = (line: string): boolean =>
        line.trim() === "" ||
        // Any bullet immediately after the block is leaked debris — real
        // content resumes with a heading (`## Purpose`, `## Install`, …).
        // Matches both link bullets and the degraded plain-text bullets that
        // prior re-truncation produced.
        /^\s*-\s/.test(line) ||
        /<!--\s*(?:begin|end):auto-docs\s*-->/.test(line) ||
        /<!--\s*en…/u.test(line);
    const lines = rest.split("\n");
    let i = 0;
    while (i < lines.length && isLeaked(lines[i] ?? "")) i++;
    return lines.slice(i).join("\n");
}

export function replaceMarkedSection(
    content: string,
    replacement: string
): { next: string; changed: boolean } {
    const beginIdx = content.indexOf(AUTO_MARKER_BEGIN);
    const endIdx = content.indexOf(AUTO_MARKER_END);
    const block = `${AUTO_MARKER_BEGIN}\n${replacement.trim()}\n${AUTO_MARKER_END}`;

    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
        const before = content.slice(0, beginIdx);
        const after = stripLeakedTrailer(
            content.slice(endIdx + AUTO_MARKER_END.length)
        );
        const tail = after.length > 0 ? `\n\n${after}` : "\n";
        const next = `${before}${block}${tail}`;
        return { next, changed: next !== content };
    }

    const headingMatch = content.match(/^##\s.*$/m);
    if (headingMatch?.index !== undefined) {
        const insertAt = headingMatch.index;
        const before = content.slice(0, insertAt);
        const after = content.slice(insertAt);
        const sep = before.endsWith("\n\n")
            ? ""
            : before.endsWith("\n")
              ? "\n"
              : "\n\n";
        const trailing = after.startsWith("\n") ? "" : "\n\n";
        const next = `${before}${sep}${block}${trailing}${after}`;
        return { next, changed: true };
    }

    const trimmed = content.replace(/\s+$/u, "");
    const next = `${trimmed}\n\n${block}\n`;
    return { next, changed: next !== content };
}

/**
 * Pull every relative `.md` link target out of markdown content. Returns
 * absolute filesystem paths resolved against `sourcePath`'s directory.
 * Non-relative links (`http(s)://`, anchors, absolute URLs) are skipped.
 */
export function extractRelativeMdLinks(
    content: string,
    sourcePath: string
): string[] {
    const out: string[] = [];
    const base = dirname(sourcePath);
    const matches = content.matchAll(/\[(?:[^\]]*)\]\(([^)]+)\)/g);
    for (const match of matches) {
        const raw = (match[1] ?? "").split("#")[0]?.trim() ?? "";
        if (raw?.endsWith(".md") && !/^(?:https?:|mailto:|\/)/.test(raw)) {
            out.push(join(base, raw));
        }
    }
    return out;
}

/**
 * For a directory, return the canonical `.md` doc. Priority order:
 *   1. `<dirName>.md` (matches directory name)
 *   2. `README.md`
 *   3. The single non-`.types.md` `.md` file if exactly one exists
 *   4. `undefined`
 */
export function findCanonicalMd(
    dir: string,
    dirName: string
): string | undefined {
    const candidates: string[] = [];
    let entries: ReturnType<typeof readdirSync>;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return undefined;
    }
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        if (entry.name.endsWith(".types.md")) continue;
        candidates.push(entry.name);
    }
    const exact = `${dirName}.md`;
    if (candidates.includes(exact)) return join(dir, exact);
    if (candidates.includes("README.md")) return join(dir, "README.md");
    if (candidates.length === 1) return join(dir, candidates[0] ?? "");
    return undefined;
}

export function isDirectorySafe(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

export function tryRead(path: string): string | undefined {
    try {
        return readFileSync(path, "utf-8");
    } catch {
        return undefined;
    }
}

export function relForLink(from: string, to: string): string {
    const rel = relative(dirname(from), to).replace(/\\/g, "/");
    return rel.startsWith(".") ? rel : `./${rel}`;
}
