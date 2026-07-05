# `tooling`

Local, private, workspace-only wrapper packages that layer this repo's own customization point on top of the published `@suaveplan/*` foundation packages (`biome-config`, `typescript-config`, `vite-config`). Apps and packages under `packages/` extend from these (`@repo/*`), not from `@suaveplan/*` directly, so a repo-wide lint rule, compiler option, or build default only has to change in one file instead of every package that uses it.

None of these are ever published — every package here is `"private": true`.

<!-- begin:auto-docs -->
## Packages in `tooling`

3 packages.

| Package | Description |
|---|---|
| [`@repo/biome-config`](./biome-config/README.md) | This repo's own Biome rule overlay. Apps and packages extend **both** this package and `@suaveplan/biome-config` directly, in that order, so a repo-wide rule t… |
| [`@repo/typescript-config`](./typescript-config/README.md) | This repo's own tsconfig extension point. Every variant here layers `./base.json` underneath the matching `@suaveplan/typescript-config` preset (TypeScript 5+… |
| [`@repo/vite-config`](./vite-config/README.md) | This repo's own Vite library build config extension point, layered on top of `@suaveplan/vite-config`. Apps and packages import this instead of the upstream co… |
<!-- end:auto-docs -->
