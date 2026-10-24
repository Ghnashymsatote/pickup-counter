import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import {
    baseUrl,
    createPool,
    createTestProduct,
    deleteTestProduct,
    getAvailable,
    getStock,
    placeOrder,
    placeOrderOk,
    sendWebhook,
} from "./helpers";

describe("Stock holds and expiry", () => {
    let pool: Pool;
    let productId: string;

    beforeAll(async () => {
        pool = createPool();
        productId = await createTestProduct(pool, {
            label: "Hold Test",
            pricePaise: 1500,
            stock: 3,
        });
    });

    afterAll(async () => {
        await deleteTestProduct(pool, productId);
        await pool.end();
    });

    it("reports seconds left on the hold, measured on the server", async () => {
        const order = await placeOrderOk(productId, 1);

        // The hold is 120s by default, and the response is sent immediately
        // after the insert, so there should be nearly all of it left.
        expect(order.expiresInSeconds).toBeGreaterThan(100);
        expect(order.expiresInSeconds).toBeLessThanOrEqual(120);

        // The same value is available on every read, which is what the
        // screen counts down from instead of trusting its own clock.
        const response = await fetch(`${baseUrl}/orders/${order.id}`);
        const body = (await response.json()) as {
            order: { expiresInSeconds: number; serverTime: string };
        };

        expect(body.order.expiresInSeconds).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(body.order.serverTime))).toBe(false);
    });

    it("removes held units from available stock without changing stock", async () => {
        const otherProductId = await createTestProduct(pool, {
            label: "Availability Test",
            pricePaise: 1500,
            stock: 4,
        });

        try {
            await expect(getAvailable(otherProductId)).resolves.toBe(4);

            await placeOrderOk(otherProductId, 3);

            // The units are held, not sold: available drops, stock does not.
            await expect(getAvailable(otherProductId)).resolves.toBe(1);
            await expect(getStock(pool, otherProductId)).resolves.toBe(4);
        } finally {
            await deleteTestProduct(pool, otherProductId);
        }
    });

    it("releases the units and shows the order expired once the hold runs out", async () => {
        const otherProductId = await createTestProduct(pool, {
            label: "Expiry Test",
            pricePaise: 1500,
            stock: 1,
        });

        try {
            const order = await placeOrderOk(otherProductId, 1);

            await expect(getAvailable(otherProductId)).resolves.toBe(0);

            // A second customer cannot buy the held unit.
            const blocked = await placeOrder(otherProductId, 1);
            expect(blocked.status).toBe(409);

            // Rather than waiting out the real 120 seconds, move the
            // deadline into the past. Everything downstream compares
            // against the database clock, so this is the same situation.
            await pool.query(
                `UPDATE orders
                    SET expires_at = clock_timestamp() - INTERVAL '1 second'
                  WHERE id = $1`,
                [order.id],
            );

            // The unit is available again immediately.
            await expect(getAvailable(otherProductId)).resolves.toBe(1);

            // And the order now reads as expired.
            const response = await fetch(`${baseUrl}/orders/${order.id}`);
            const body = (await response.json()) as {
                order: { status: string; expiresInSeconds: number };
            };

            expect(body.order.status).toBe("expired");
            expect(body.order.expiresInSeconds).toBe(0);

            // Someone else can now buy it.
            const next = await placeOrder(otherProductId, 1);
            expect(next.status).toBe(201);
        } finally {
            await deleteTestProduct(pool, otherProductId);
        }
    });

    it("keeps paid-but-uncollected units out of available stock", async () => {
        const otherProductId = await createTestProduct(pool, {
            label: "Paid Hold Test",
            pricePaise: 1500,
            stock: 1,
        });

        try {
            const order = await placeOrderOk(otherProductId, 1);

            await sendWebhook({
                orderId: order.id,
                amountPaise: order.totalPaise,
            });

            // Stock is only decremented at pickup, so without the paid-order
            // term in the availability rule this unit would look sellable
            // again the moment the 120s window passed.
            await pool.query(
                `UPDATE orders
                    SET expires_at = clock_timestamp() - INTERVAL '1 second'
                  WHERE id = $1`,
                [order.id],
            );

            await expect(getAvailable(otherProductId)).resolves.toBe(0);
            expect((await placeOrder(otherProductId, 1)).status).toBe(409);
        } finally {
            await deleteTestProduct(pool, otherProductId);
        }
    });
});
