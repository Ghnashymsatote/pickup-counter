import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import {
    createPool,
    createTestProduct,
    deleteTestProduct,
    getAvailable,
    placeOrder,
} from "./helpers";

describe("Concurrent orders for the last units", () => {
    let pool: Pool;
    let productId: string;

    beforeAll(async () => {
        pool = createPool();
        productId = await createTestProduct(pool, {
            label: "Concurrency Test",
            pricePaise: 100,
            stock: 2,
        });
    });

    afterAll(async () => {
        await deleteTestProduct(pool, productId);
        await pool.end();
    });

    it("holds exactly two units when ten customers order the last two", async () => {
        // All ten requests are in flight before any of them has committed.
        const responses = await Promise.all(
            Array.from({ length: 10 }, () => placeOrder(productId, 1)),
        );

        const statuses = responses.map((response) => response.status);
        const bodies = await Promise.all(
            responses.map((response) => response.json()),
        );

        expect(statuses.filter((status) => status === 201)).toHaveLength(2);
        expect(statuses.filter((status) => status === 409)).toHaveLength(8);

        // The eight losers must fail cleanly, with a usable error — not a 500.
        for (const [index, status] of statuses.entries()) {
            if (status !== 409) continue;

            const body = bodies[index] as {
                error: string;
                message: string;
                availableStock: number;
            };

            expect(body.error).toBe("INSUFFICIENT_STOCK");
            expect(body.message).toBeTruthy();
            expect(body.availableStock).toBe(0);
        }

        // And the database must agree: exactly two units are held.
        const held = await pool.query<{ held: string }>(
            `SELECT COALESCE(SUM(oi.quantity), 0)::text AS held
               FROM order_items oi
               JOIN orders o ON o.id = oi.order_id
              WHERE oi.product_id = $1
                AND o.status = 'pending'
                AND o.expires_at > clock_timestamp()`,
            [productId],
        );

        expect(Number(held.rows[0]!.held)).toBe(2);

        // No units were sold, so stock is untouched and nothing is available.
        const stock = await pool.query<{ stock: number }>(
            `SELECT stock FROM products WHERE id = $1`,
            [productId],
        );

        expect(stock.rows[0]!.stock).toBe(2);
        await expect(getAvailable(productId)).resolves.toBe(0);
    });

    it("rejects an order for more units than exist and holds nothing", async () => {
        const otherProductId = await createTestProduct(pool, {
            label: "Oversell Test",
            pricePaise: 500,
            stock: 3,
        });

        try {
            const response = await placeOrder(otherProductId, 4);

            expect(response.status).toBe(409);
            expect(await getAvailable(otherProductId)).toBe(3);

            const orders = await pool.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count
                   FROM order_items
                  WHERE product_id = $1`,
                [otherProductId],
            );

            expect(Number(orders.rows[0]!.count)).toBe(0);
        } finally {
            await deleteTestProduct(pool, otherProductId);
        }
    });
});
