import type { LibConfigOptions } from "@suaveplan/vite-config";
import { defineLibConfig as suaveplanDefineLibConfig } from "@suaveplan/vite-config";
import type { UserConfig } from "vite";

export type DefineLibConfigOptions = LibConfigOptions;

/**
 * This repo's own extension point for `@suaveplan/vite-config`'s
 * `defineLibConfig`. Every package's `vite.config.ts` should import this
 * instead of `@suaveplan/vite-config` directly, so a repo-wide build default
 * (an extra plugin, a wider external list, a different tsconfig path) only
 * has to change in this one file.
 */
export function defineLibConfig(
    dir: string,
    options?: DefineLibConfigOptions
): UserConfig {
    return suaveplanDefineLibConfig(dir, options);
}
