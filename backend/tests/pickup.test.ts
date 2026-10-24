import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import {
    baseUrl,
    createPool,
    createTestProduct,
    deleteTestProduct,
    getOrderStatus,
    getStock,
    placeOrderOk,
    sendWebhook,
} from "./helpers";

const PRICE_PAISE = 2500;

function claim(orderId: string): Promise<Response> {
    return fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, {
        method: "POST",
    });
}

describe("Pickup claims", () => {
    let pool: Pool;
    let productId: string;

    beforeAll(async () => {
        pool = createPool();
        productId = await createTestProduct(pool, {
            label: "Pickup Test",
            pricePaise: PRICE_PAISE,
            stock: 10,
        });
    });

    afterAll(async () => {
        await deleteTestProduct(pool, productId);
        await pool.end();
    });

    it("lets exactly one of two simultaneous lockers claim the order", async () => {
        const order = await placeOrderOk(productId, 2);

        const paid = await sendWebhook({
            orderId: order.id,
            amountPaise: order.totalPaise,
        });
        expect(paid.status).toBe(200);

        const stockBefore = await getStock(pool, productId);

        // Two lockers, same instant.
        const responses = await Promise.all([claim(order.id), claim(order.id)]);
        const statuses = responses.map((response) => response.status);

        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
        expect(statuses.filter((status) => status === 409)).toHaveLength(1);

        const loser = responses.find((response) => response.status === 409)!;
        expect(await loser.json()).toMatchObject({
            error: "ALREADY_CLAIMED",
        });

        // The decisive assertion: stock fell by the order quantity exactly
        // once, not twice.
        expect(await getStock(pool, productId)).toBe(stockBefore - 2);
        expect(await getOrderStatus(order.id)).toBe("claimed");
    });

    it("refuses a third claim on an already collected order", async () => {
        const order = await placeOrderOk(productId, 1);

        await sendWebhook({
            orderId: order.id,
            amountPaise: order.totalPaise,
        });

        expect((await claim(order.id)).status).toBe(200);

        const stockAfterFirst = await getStock(pool, productId);

        const second = await claim(order.id);
        expect(second.status).toBe(409);

        expect(await getStock(pool, productId)).toBe(stockAfterFirst);
    });

    it("refuses to claim an unpaid order", async () => {
        const order = await placeOrderOk(productId, 1);
        const stockBefore = await getStock(pool, productId);

        const response = await claim(order.id);

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
            error: "PAYMENT_REQUIRED",
        });

        expect(await getStock(pool, productId)).toBe(stockBefore);
        expect(await getOrderStatus(order.id)).toBe("pending");
    });

    it("refuses to claim an expired order and marks it expired", async () => {
        const order = await placeOrderOk(productId, 1);

        await pool.query(
            `UPDATE orders
                SET expires_at = clock_timestamp() - INTERVAL '1 second'
              WHERE id = $1`,
            [order.id],
        );

        const stockBefore = await getStock(pool, productId);
        const response = await claim(order.id);

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
            error: "ORDER_EXPIRED",
        });

        expect(await getStock(pool, productId)).toBe(stockBefore);
        expect(await getOrderStatus(order.id)).toBe("expired");
    });

    it("404s for an order that does not exist", async () => {
        const response = await claim("00000000-0000-4000-8000-000000000000");

        expect(response.status).toBe(404);
    });

    it("400s for an order id that is not a UUID", async () => {
        const response = await claim("not-a-uuid");

        expect(response.status).toBe(400);
    });
});
