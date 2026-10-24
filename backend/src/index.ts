import app from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./config/db.js";
import { runMigrations, waitForDatabase } from "./db/migrate.js";

async function main(): Promise<void> {
    await waitForDatabase();

    if (env.RUN_MIGRATIONS_ON_BOOT) {
        // `docker compose up` has to produce a working app from an empty
        // volume, so the schema and seed data are applied here rather than
        // left as a manual step.
        await runMigrations();
    }

    const server = app.listen(env.PORT, "0.0.0.0", () => {
        console.log(
            `Backend listening on port ${env.PORT} (${env.NODE_ENV}), ` +
                `${env.HOLD_SECONDS}s stock holds`,
        );
    });

    // Finish in-flight requests before exiting, so a deploy or a Ctrl+C
    // cannot abandon a transaction mid-claim.
    const shutdown = (signal: string) => {
        console.log(`${signal} received, shutting down.`);

        server.close(() => {
            void pool.end().then(() => process.exit(0));
        });

        setTimeout(() => {
            console.error("Forced shutdown after 10s timeout.");
            process.exit(1);
        }, 10_000).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
    console.error("Failed to start backend:", error);
    process.exit(1);
});
