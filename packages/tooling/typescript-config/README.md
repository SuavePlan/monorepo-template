# `@repo/typescript-config`

This repo's own tsconfig extension point. Every variant here layers `./base.json` underneath the matching `@suaveplan/typescript-config` preset (TypeScript 5+ supports an array of `extends` targets, applied left-to-right, so a later entry's fields win on conflict). A repo-wide compiler-option tweak added to `base.json` automatically flows into every tier variant below — it doesn't need to be repeated in each one.

## Variants

| File | Use for |
|---|---|
| `base.json` | Rarely extended directly; the shared root every other variant builds on |
| `library.json` | Universal (tier-agnostic) library packages |
| `library-browser.json` | Browser-tier packages (DOM ok) |
| `library-node.json` | Server-tier packages (Node.js ok) |
| `react-library.json` | React component packages |
| `test.json` | `tsconfig` used for test-only type-checking |
| `stories.json` | `.stories.tsx` type-checking |

## Install

```bash
bun add -D @repo/typescript-config
```

## Usage

```json
// packages/<category>/<pkg>/tsconfig.lib.json
{
    "extends": "@repo/typescript-config/library.json",
    "compilerOptions": {
        "rootDir": "src",
        "outDir": "dist"
    },
    "include": ["src/**/*"]
}
```

Swap `library.json` for whichever variant matches the package's tier.

## Customizing

Add a repo-wide compiler option to `base.json` here rather than to every package's own `tsconfig.lib.json` — it propagates to all seven variants automatically.
