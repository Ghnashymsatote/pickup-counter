import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

// An idle client erroring out (for example, the database restarting) emits on
// the pool. Without a listener this would crash the process.
pool.on("error", (error) => {
    console.error("Unexpected idle database client error:", error);
});

/**
 * Runs `work` inside a transaction, committing on success and rolling back on
 * any throw. Every multi-statement write in this app goes through here so no
 * route can leak a half-applied transaction or an unreleased client.
 */
export async function withTransaction<T>(
    work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK").catch((rollbackError: unknown) => {
            console.error("Transaction rollback failed:", rollbackError);
        });
        throw error;
    } finally {
        client.release();
    }
}
