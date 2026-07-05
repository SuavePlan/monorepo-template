# `define-lib-config`

## Purpose

`defineLibConfig` is this repo's own extension point for `@suaveplan/vite-config`'s shared library build factory. Every package and app in this monorepo builds with Vite in library mode, and every one of those builds needs the same non-negotiable behavior: rollup externals derived from the consuming package's own `package.json` (so a published `dist/` never bakes in a store path for a dependency that should stay a bare import), `preserveModules` output so per-module subpath exports resolve to real files, and a `vite-plugin-dts` pass for declaration files.

Rather than have every package's `vite.config.ts` import `@suaveplan/vite-config` directly, this module exists so a repo-wide build default — an extra plugin every package should pick up, a wider default external list, a different `tsconfig` path convention — only has to change in one place. Today it forwards its arguments unchanged; the value is that the extension point exists, not that it currently does anything beyond delegate.

## Features

- Re-exports the upstream `defineLibConfig(dir, options)` signature verbatim, so switching a package from `@suaveplan/vite-config` to `@repo/vite-config` is a drop-in import change.
- Re-exports the upstream `LibConfigOptions` type as `DefineLibConfigOptions`, so the option surface can never drift out of sync with the dependency it wraps.
- Single seam for repo-wide Vite build customization, without touching the published `@suaveplan/vite-config` package or every consumer's own config.

## Usage: Basic Example

```ts
// vite.config.ts
import { defineLibConfig } from "@repo/vite-config";

export default defineLibConfig(__dirname);
```

## Usage: Advanced Example

```ts
// vite.config.ts — custom entry and an extra plugin
import { defineLibConfig } from "@repo/vite-config";
import { myPlugin } from "some-vite-plugin";

export default defineLibConfig(__dirname, {
    entry: "src/main.ts",
    plugins: [myPlugin()],
});
```

## API Reference

### `defineLibConfig(dir: string, options?: DefineLibConfigOptions): UserConfig`

Builds a Vite `UserConfig` for a library package rooted at `dir`. `options` are forwarded unchanged to `@suaveplan/vite-config`'s `defineLibConfig`. Throws nothing directly; any error surfaces from the underlying call (e.g. an unreadable `package.json` at `dir`).

### `DefineLibConfigOptions`

A type alias for `@suaveplan/vite-config`'s `LibConfigOptions`: `entry`, `bundle`, `external`, `tsconfigPath`, `plugins`.

## Implementation Notes

This module is deliberately a thin pass-through today. It is not a stub — it is a complete, working extension point whose customization hooks currently sit at the upstream defaults. When a repo-wide Vite build change is needed, it lands here so every consumer picks it up without an individual edit.
