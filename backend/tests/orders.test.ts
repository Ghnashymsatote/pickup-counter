
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
describe("PostgreSQL connection", () => {
    it("connects to the real assignment database", async () => {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });

        try {
            const result = await pool.query<{
                database_name: string;
                database_time: Date;
            }>(
                `SELECT current_database() AS database_name,
                clock_timestamp() AS database_time`,
            );

            expect(result.rows[0].database_name).toBe("pickup_counter");
            expect(result.rows[0].database_time).toBeInstanceOf(Date);
        } finally {
            await pool.end();
        }
    });
});
// Add this test below your existing PostgreSQL connection test.
describe("Concurrent order reservations", () => {
    it("allows only 2 of 10 customers to reserve the last 2 units", async () => {
        const baseUrl = process.env.API_BASE_URL ?? "http://localhost:5001";
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });

        const productName = `Concurrency Test ${randomUUID()}`;
        let productId: string | undefined;

        try {
            // Create a separate test product; do not modify seeded products.
            const inserted = await pool.query<{ id: string }>(
                `INSERT INTO products (name, price_paise, stock)
         VALUES ($1, 100, 2)
         RETURNING id`,
                [productName],
            );

            productId = inserted.rows[0].id;

            // Ten customers submit an order at almost the same time.
            const responses = await Promise.all(
                Array.from({ length: 10 }, () =>
                    fetch(`${baseUrl}/orders`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            items: [{ productId, quantity: 1 }],
                        }),
                    }),
                ),
            );

            const results = await Promise.all(
                responses.map(async (response) => ({
                    status: response.status,
                    body: await response.json(),
                })),
            );

            const successful = results.filter((r) => r.status === 201);
            const rejected = results.filter((r) => r.status === 409);

            expect(successful).toHaveLength(2);
            expect(rejected).toHaveLength(8);

            // Verify the database still has exactly two reserved units.
            const reservations = await pool.query<{ reserved: string }>(
                `SELECT COALESCE(SUM(oi.quantity), 0)::text AS reserved
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = $1
           AND o.status = 'pending'
           AND o.expires_at > clock_timestamp()`,
                [productId],
            );

            expect(Number(reservations.rows[0].reserved)).toBe(2);

            // Ensure every request returned a meaningful response.
            expect(results.every((r) => r.body !== undefined)).toBe(true);
        } finally {
            if (productId) {
                // Delete only this test product's orders and related records.
                await pool.query(
                    `DELETE FROM webhook_events
           WHERE order_id IN (
             SELECT DISTINCT oi.order_id
             FROM order_items oi
             WHERE oi.product_id = $1
           )`,
                    [productId],
                );

                await pool.query(
                    `DELETE FROM orders
           WHERE id IN (
             SELECT DISTINCT order_id
             FROM order_items
             WHERE product_id = $1
           )`,
                    [productId],
                );

                await pool.query(
                    `DELETE FROM products WHERE id = $1`,
                    [productId],
                );
            }

            await pool.end();
        }
    });
});

describe("Duplicate payment webhook", () => {
    it("deducts stock only once when the same event is delivered twice", async () => {
        const baseUrl = process.env.API_BASE_URL ?? "http://localhost:5001";
        const secret = process.env.WEBHOOK_SECRET;

        if (!secret) {
            throw new Error("WEBHOOK_SECRET is missing from backend/.env");
        }

        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });

        const productName = `Webhook Test ${randomUUID()}`;
        let productId: string | undefined;
        let orderId: string | undefined;

        try {
            const product = await pool.query<{ id: string }>(
                `INSERT INTO products (name, price_paise, stock)
         VALUES ($1, 2500, 5)
         RETURNING id`,
                [productName],
            );
            productId = product.rows[0].id;

            const orderResponse = await fetch(`${baseUrl}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: [{ productId, quantity: 1 }],
                }),
            });

            expect(orderResponse.status).toBe(201);

            const orderBody = await orderResponse.json() as {
                order: {
                    id: string;
                };
            };

            orderId = orderBody.order.id;

            expect(orderId).toBeTruthy();

            const payload = {
                eventId: `evt_test_${randomUUID()}`,
                orderId: orderId!,
                amountPaise: 2500,
                status: "captured",
            };

            const rawBody = JSON.stringify(payload);
            const signature = createHmac("sha256", secret)
                .update(rawBody)
                .digest("hex");

            const sendWebhook = () =>
                fetch(`${baseUrl}/payments/webhook`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Signature": signature,
                    },
                    body: rawBody,
                });

            const firstResponse = await sendWebhook();
            expect(firstResponse.status).toBe(200);
            await firstResponse.json();

            const secondResponse = await sendWebhook();
            expect(secondResponse.status).toBe(200);

            const duplicateBody = await secondResponse.json() as {
                duplicate?: boolean;
            };
            expect(duplicateBody.duplicate).toBe(true);

            const stockResult = await pool.query<{ stock: number }>(
                `SELECT stock FROM products WHERE id = $1`,
                [productId],
            );
            expect(stockResult.rows[0].stock).toBe(4);

            const eventResult = await pool.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count
         FROM webhook_events
         WHERE event_id = $1`,
                [payload.eventId],
            );
            expect(Number(eventResult.rows[0].count)).toBe(1);


        } finally {
            if (productId) {
                // Find every order referencing this test product.
                const relatedOrders = await pool.query<{ order_id: string }>(
                    `SELECT DISTINCT order_id
                     FROM order_items
                     WHERE product_id = $1`,
                    [productId],
                );

                const relatedOrderIds = relatedOrders.rows.map(
                    (row) => row.order_id,
                );

                // Delete webhook events before deleting their orders.
                if (relatedOrderIds.length > 0) {
                    await pool.query(
                        `DELETE FROM webhook_events
                         WHERE order_id = ANY($1::uuid[])`,
                        [relatedOrderIds],
                    );

                    await pool.query(
                        `DELETE FROM orders
                         WHERE id = ANY($1::uuid[])`,
                        [relatedOrderIds],
                    );
                }

                // Deleting orders cascades to order_items.
                await pool.query(
                    `DELETE FROM products WHERE id = $1`,
                    [productId],
                );
            }

            await pool.end();
        }


    });
});

describe("Simultaneous pickup claims", () => {
    it("allows exactly one claim for a paid order", async () => {
        const baseUrl = process.env.API_BASE_URL ?? "http://localhost:5001";
        const secret = process.env.WEBHOOK_SECRET;

        if (!secret) {
            throw new Error("WEBHOOK_SECRET is missing from backend/.env");
        }

        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });

        const productName = `Pickup Test ${randomUUID()}`;
        let productId: string | undefined;

        try {
            // Create a separate product for this test.
            const product = await pool.query<{ id: string }>(
                `INSERT INTO products (name, price_paise, stock)
                 VALUES ($1, 2500, 5)
                 RETURNING id`,
                [productName],
            );
            productId = product.rows[0].id;

            // Create an order for one unit.
            const orderResponse = await fetch(`${baseUrl}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: [{ productId, quantity: 1 }],
                }),
            });

            expect(orderResponse.status).toBe(201);

            const orderBody = await orderResponse.json() as {
                order: { id: string };
            };
            const orderId = orderBody.order.id;

            // Simulate a successful payment.
            const payload = {
                eventId: `evt_pickup_${randomUUID()}`,
                orderId,
                amountPaise: 2500,
                status: "captured",
            };

            const rawBody = JSON.stringify(payload);
            const signature = createHmac("sha256", secret)
                .update(rawBody)
                .digest("hex");

            const paymentResponse = await fetch(
                `${baseUrl}/payments/webhook`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Signature": signature,
                    },
                    body: rawBody,
                },
            );

            expect(paymentResponse.status).toBe(200);

            // Two claims arrive at almost the same time.
            const claim = () =>
                fetch(`${baseUrl}/orders/${orderId}/pickup-claim`, {
                    method: "POST",
                });

            const claimResponses = await Promise.all([
                claim(),
                claim(),
            ]);

            const statuses = claimResponses.map(
                (response) => response.status,
            );

            expect(statuses.filter((status) => status === 200)).toHaveLength(1);
            expect(statuses.filter((status) => status === 409)).toHaveLength(1);
        } finally {
            if (productId) {
                // Remove related webhook records before removing orders.
                const relatedOrders = await pool.query<{ order_id: string }>(
                    `SELECT DISTINCT order_id
                     FROM order_items
                     WHERE product_id = $1`,
                    [productId],
                );

                const orderIds = relatedOrders.rows.map(
                    (row) => row.order_id,
                );

                if (orderIds.length > 0) {
                    await pool.query(
                        `DELETE FROM webhook_events
                         WHERE order_id = ANY($1::uuid[])`,
                        [orderIds],
                    );

                    await pool.query(
                        `DELETE FROM orders
                         WHERE id = ANY($1::uuid[])`,
                        [orderIds],
                    );
                }

                await pool.query(
                    `DELETE FROM products WHERE id = $1`,
                    [productId],
                );
            }

            await pool.end();
        }
    });
});
