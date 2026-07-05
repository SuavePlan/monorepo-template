/**
 * Centralized configuration for scripts.
 *
 * All registry URLs, paths, and validation thresholds are defined here to
 * avoid hardcoding values across multiple scripts.
 */

export const CONFIG = {
    /**
     * Registry configuration — points at the shared private Verdaccio
     * registry (see bunfig.toml / .npmrc). Credentials come from the
     * gitignored `.env` (Bun auto-loads it) — never commit them.
     */
    registry: {
        verdaccio: {
            url: process.env.NPM_URL || "https://npmjs.fq.io/",
            s3: {
                endpoint: process.env.S3_ENDPOINT || "https://s3.fq.io",
                bucket: process.env.S3_BUCKET || "npmjs",
                region: process.env.S3_REGION || "uk",
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            },
        },
    },

    /**
     * Monorepo paths.
     */
    paths: {
        root: process.env.MONOREPO_ROOT || process.cwd(),

        /**
         * Root for all workspace packages. Canonical layout is
         * `packages/<category>/<pkg>/` — see `discoverPackageDirs` in
         * `./discover-packages.ts` for the 2-level walk (with flat and
         * 3-level fallbacks, so a package can also live at
         * `packages/<pkg>/` or `packages/<category>/<subcategory>/<pkg>/`
         * without breaking discovery).
         */
        packagesRoot: "packages",
    },

    /**
     * Test-runner-import gate configuration (see openspec/AGENTS.md §7).
     * Packages listed here are exempt from the "import test-runner
     * primitives via the neutral wrapper" rule because they author or
     * extend that wrapper themselves. Empty until this project has its
     * own testing-infrastructure package(s) — add entries as those land.
     */
    testing: {
        exemptRunnerWrapperPackages: [] as readonly string[],
    },

    /**
     * Quality and validation thresholds.
     */
    validation: {
        minCoverage: 100,
        minDocsCoverage: 100,
    },

    /**
     * Build and test settings.
     */
    build: {
        cacheDir: "node_modules/.vite",
        distDir: "dist",
    },

    /**
     * Exit codes for consistent error handling.
     */
    exitCodes: {
        success: 0,
        failure: 1,
        partialSuccess: 2,
    },
} as const;

/**
 * Type-safe access to config values.
 */
export type Config = typeof CONFIG;
