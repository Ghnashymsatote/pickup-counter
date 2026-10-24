import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // These are integration tests against a live backend and a real
        // PostgreSQL database. Concurrency assertions need real wall-clock
        // room, so the default 5s timeout is too tight.
        testTimeout: 30_000,
        hookTimeout: 30_000,
        globalSetup: ["./tests/globalSetup.ts"],
    },
});
