import "dotenv/config";
import { pool } from "../src/config/db.js";
import { runMigrations, waitForDatabase } from "../src/db/migrate.js";

// Applies sql/ by hand, for the case where the backend is not being started
// (for example preparing a database before running the tests).
async function main(): Promise<void> {
    await waitForDatabase();
    await runMigrations();
    console.log("Migrations complete.");
}

main()
    .catch((error: unknown) => {
        console.error("Migration failed:", error);
        process.exitCode = 1;
    })
    .finally(() => void pool.end());
