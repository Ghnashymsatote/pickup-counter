import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import {
    createPool,
    createTestProduct,
    deleteTestProduct,
    getOrderStatus,
    getStock,
    placeOrderOk,
    sendWebhook,
} from "./helpers";

const PRICE_PAISE = 2500;

describe("Payment webhook", () => {
    let pool: Pool;
    let productId: string;

    beforeAll(async () => {
        pool = createPool();
        productId = await createTestProduct(pool, {
            label: "Webhook Test",
            pricePaise: PRICE_PAISE,
            stock: 10,
        });
    });

    afterAll(async () => {
        await deleteTestProduct(pool, productId);
        await pool.end();
    });

    it("processes the same event only once when it is delivered twice", async () => {
        const order = await placeOrderOk(productId, 1);
        const eventId = `evt_dup_${randomUUID()}`;

        const send = () =>
            sendWebhook({
                eventId,
                orderId: order.id,
                amountPaise: order.totalPaise,
            });

        const first = await send();
        expect(first.status).toBe(200);
        expect(await first.json()).toMatchObject({
            duplicate: false,
            outcome: "payment_succeeded",
            orderStatus: "paid",
        });

        // The provider redelivers. The second call must change nothing and
        // must still answer 200, or the provider would keep retrying.
        const second = await send();
        expect(second.status).toBe(200);
        expect(await second.json()).toMatchObject({
            duplicate: true,
            outcome: "payment_succeeded",
            orderStatus: "paid",
        });

        const events = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
               FROM webhook_events
              WHERE event_id = $1`,
            [eventId],
        );

        expect(Number(events.rows[0]!.count)).toBe(1);
        expect(await getOrderStatus(order.id)).toBe("paid");
    });

    it("survives the same event arriving twice at the same instant", async () => {
        const order = await placeOrderOk(productId, 1);
        const eventId = `evt_race_${randomUUID()}`;

        // Both deliveries race for the same primary key. One inserts; the
        // other must lose the race and replay the stored outcome.
        const [first, second] = await Promise.all([
            sendWebhook({
                eventId,
                orderId: order.id,
                amountPaise: order.totalPaise,
            }),
            sendWebhook({
                eventId,
                orderId: order.id,
                amountPaise: order.totalPaise,
            }),
        ]);

        expect([first.status, second.status]).toEqual([200, 200]);

        const bodies = (await Promise.all([first.json(), second.json()])) as {
            duplicate: boolean;
        }[];

        // Exactly one of them did the work.
        expect(bodies.filter((body) => !body.duplicate)).toHaveLength(1);
        expect(await getOrderStatus(order.id)).toBe("paid");
    });

    it("rejects a webhook whose signature does not match", async () => {
        const order = await placeOrderOk(productId, 1);

        const response = await sendWebhook({
            orderId: order.id,
            amountPaise: order.totalPaise,
            signature: "a".repeat(64),
        });

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
            error: "INVALID_SIGNATURE",
        });

        // An unsigned event must not touch the order at all.
        expect(await getOrderStatus(order.id)).toBe("pending");
    });

    it("rejects a webhook with a malformed signature header", async () => {
        const order = await placeOrderOk(productId, 1);

        const response = await sendWebhook({
            orderId: order.id,
            amountPaise: order.totalPaise,
            signature: "not-a-hex-digest",
        });

        expect(response.status).toBe(401);
        expect(await getOrderStatus(order.id)).toBe("pending");
    });

    it("marks an order needs_review when the amount does not match", async () => {
        const order = await placeOrderOk(productId, 1);

        const response = await sendWebhook({
            orderId: order.id,
            // Correctly signed, but for the wrong amount.
            amountPaise: order.totalPaise - 100,
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            outcome: "amount_mismatch_needs_review",
            orderStatus: "needs_review",
        });

        expect(await getOrderStatus(order.id)).toBe("needs_review");
    });

    it("sends a valid late payment to needs_review instead of fulfilling it", async () => {
        const order = await placeOrderOk(productId, 1);

        // Force the hold to have run out, the way it would after 120s.
        await pool.query(
            `UPDATE orders
                SET expires_at = clock_timestamp() - INTERVAL '1 second'
              WHERE id = $1`,
            [order.id],
        );

        const stockBefore = await getStock(pool, productId);

        const response = await sendWebhook({
            orderId: order.id,
            amountPaise: order.totalPaise,
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            outcome: "late_payment_needs_review",
            orderStatus: "needs_review",
        });

        // The customer is never silently given units that may have been
        // resold, and stock is not touched.
        expect(await getStock(pool, productId)).toBe(stockBefore);
        expect(await getOrderStatus(order.id)).toBe("needs_review");
    });

    it("rejects an event id reused with different payment data", async () => {
        const first = await placeOrderOk(productId, 1);
        const second = await placeOrderOk(productId, 1);
        const eventId = `evt_conflict_${randomUUID()}`;

        const ok = await sendWebhook({
            eventId,
            orderId: first.id,
            amountPaise: first.totalPaise,
        });

        expect(ok.status).toBe(200);

        const reused = await sendWebhook({
            eventId,
            orderId: second.id,
            amountPaise: second.totalPaise,
        });

        expect(reused.status).toBe(409);
        expect(await reused.json()).toMatchObject({
            error: "EVENT_ID_CONFLICT",
        });

        // The second order was not affected by the bad replay.
        expect(await getOrderStatus(second.id)).toBe("pending");
    });

    it("leaves the order pending when a capture fails", async () => {
        const order = await placeOrderOk(productId, 1);

        const response = await sendWebhook({
            orderId: order.id,
            amountPaise: order.totalPaise,
            status: "failed",
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            outcome: "payment_failed",
            orderStatus: "pending",
        });

        // The hold stands, so the customer can retry inside the window.
        expect(await getOrderStatus(order.id)).toBe("pending");
    });

    it("404s for an unknown order", async () => {
        const response = await sendWebhook({
            orderId: randomUUID(),
            amountPaise: PRICE_PAISE,
        });

        expect(response.status).toBe(404);
    });
});
