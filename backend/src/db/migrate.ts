import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "../config/db.js";

/**
 * sql/ lives next to the compiled dist/ directory in the image and next to
 * src/ in development, so resolve it from the package root either way.
 */
const sqlDir = join(__dirname, "..", "..", "sql");

// Postgres advisory lock id. Two backend replicas starting at once would
// otherwise race to create the same tables.
const MIGRATION_LOCK_ID = 873_214_551;

function migrationFiles(): string[] {
    return readdirSync(sqlDir)
        .filter((file) => file.endsWith(".sql"))
        .sort();
}

/**
 * Applies every file in sql/ in filename order, inside one transaction.
 * The files are written to be idempotent, so this is safe on every boot and
 * there is no separate "has it run yet" state to get out of sync.
 */
export async function runMigrations(): Promise<void> {
    const client = await pool.connect();

    try {
        await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
        await client.query("BEGIN");

        for (const file of migrationFiles()) {
            const sql = readFileSync(join(sqlDir, file), "utf8");
            await client.query(sql);
            console.log(`Applied migration ${file}`);
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    } finally {
        await client
            .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
            .catch(() => undefined);
        client.release();
    }
}

/**
 * The database container reports healthy before it always accepts
 * connections, so retry briefly instead of crash-looping the backend.
 */
export async function waitForDatabase(
    attempts = 15,
    delayMs = 1000,
): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await pool.query("SELECT 1");
            return;
        } catch (error) {
            if (attempt === attempts) throw error;

            console.log(
                `Database not ready (attempt ${attempt}/${attempts}), retrying...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}
