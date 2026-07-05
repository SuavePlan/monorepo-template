import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@suaveplan/testing/runner";
import { defineLibConfig } from "./define-lib-config.js";

async function makeFixturePackage(dependencies: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), "repo-vite-config-"));
    await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ name: "fixture-pkg", dependencies })
    );
    return dir;
}

describe("defineLibConfig", () => {
    it("builds a library UserConfig with the default entry", {
        timeout: 5000,
    }, async () => {
        const dir = await makeFixturePackage({ tslib: "^2.6.2" });
        try {
            const config = defineLibConfig(dir);

            expect(config.build?.lib).toMatchObject({ entry: "src/index.ts" });
            expect(config.root).toBe(dir);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("derives the external predicate from the target package's own dependencies", {
        timeout: 5000,
    }, async () => {
        const dir = await makeFixturePackage({ tslib: "^2.6.2" });
        try {
            const config = defineLibConfig(dir);
            const external = config.build?.rollupOptions?.external;
            if (typeof external !== "function") {
                throw new Error("expected external to be a function");
            }

            expect(external("tslib", undefined, false)).toBe(true);
            expect(external("react", undefined, false)).toBe(false);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("forwards a custom entry option through to the underlying build config", {
        timeout: 5000,
    }, async () => {
        const dir = await makeFixturePackage({});
        try {
            const config = defineLibConfig(dir, { entry: "src/main.ts" });

            expect(config.build?.lib).toMatchObject({ entry: "src/main.ts" });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
