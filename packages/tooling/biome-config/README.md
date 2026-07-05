# `@repo/biome-config`

This repo's own Biome rule overlay. Apps and packages extend **both** this package and `@suaveplan/biome-config` directly, in that order, so a repo-wide rule tweak only has to happen in this one file.

Note this is a package-tier layer, separate from the root `biome.json` (which is `root: true` and already the authoritative repo-wide ruleset that every nested `root: false` config merges with). Add a rule override here when it should apply to how individual packages format/lint on their own — for anything that should apply everywhere, prefer the root config.

## Install

Already a workspace dependency wherever it's needed:

```bash
bun add -D @repo/biome-config @suaveplan/biome-config
```

## Usage

```json
// packages/<category>/<pkg>/biome.json
{
    "extends": ["@suaveplan/biome-config/biome.json", "@repo/biome-config/biome.json"],
    "root": false
}
```

Both entries are required — see the implementation note below for why.

## Customizing

Add a rule override to `biome.json` in this package directly — every consumer picks up the change on their next `bunx biome check`, no per-package edits required.

## Implementation note

`extends` in Biome 2.5.2 is **not transitive**: when a config resolves an `extends` entry (bare specifier or relative path), it reads that target file's own directly-declared settings only — it does not, in turn, process that target's own `extends` field. A wrapper package whose `biome.json` itself said `{ "extends": ["@suaveplan/biome-config/biome.json"] }` would therefore contribute nothing when referenced from a third file; the chain silently drops rather than erroring.

That's why this package's own `biome.json` has no `extends` field at all — it's a small, self-contained overrides fragment, always used as one of two parallel array entries. Verified directly: an array of two independent (non-chaining) `extends` targets merges correctly, with later entries winning on conflicting keys, which is what makes `@repo/biome-config` a real single edit point for repo-wide overrides despite this limitation. If a future Biome release makes `extends` transitive, this package could go back to wrapping `@suaveplan/biome-config` directly and consumers could drop back to a single entry.
