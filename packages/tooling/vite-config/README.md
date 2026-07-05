# `@repo/vite-config`

This repo's own Vite library build config extension point, layered on top of `@suaveplan/vite-config`. Apps and packages import this instead of the upstream config factory directly, so a repo-wide build default only has to change in one place.

<!-- begin:auto-docs -->
## Documentation tree

- [define-lib-config](./src/define-lib-config/define-lib-config.md) — `defineLibConfig` is this repo's own extension point for `@suaveplan/vite-config`'s shared library build factory. Every…
<!-- end:auto-docs -->

## Install

```bash
bun add -D @repo/vite-config
```

## Usage

```ts
// vite.config.ts
import { defineLibConfig } from "@repo/vite-config";

export default defineLibConfig(__dirname);
```

Overrides forward straight through to `@suaveplan/vite-config`:

```ts
export default defineLibConfig(__dirname, {
    entry: "src/main.ts",
    tsconfigPath: "./tsconfig.lib.json",
});
```

See [`src/define-lib-config/define-lib-config.md`](./src/define-lib-config/define-lib-config.md) for the full API reference.
