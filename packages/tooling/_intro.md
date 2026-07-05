# `tooling`

Local, private, workspace-only wrapper packages that layer this repo's own customization point on top of the published `@suaveplan/*` foundation packages (`biome-config`, `typescript-config`, `vite-config`). Apps and packages under `packages/` extend from these (`@repo/*`), not from `@suaveplan/*` directly, so a repo-wide lint rule, compiler option, or build default only has to change in one file instead of every package that uses it.

None of these are ever published — every package here is `"private": true`.
