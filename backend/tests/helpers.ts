import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";

/**
 * Shared helpers for the integration tests.
 *
 * Every test here runs against a real PostgreSQL database and a running
 * backend — nothing is mocked, because the behaviour under test (row locks,
 * unique constraints, transaction boundaries) only exists in the database.
 */

export const baseUrl = process.env.API_BASE_URL ?? "http://localhost:5001";

export const webhookSecret = (() => {
    const secret = process.env.WEBHOOK_SECRET;

    if (!secret) {
        throw new Error(
            "WEBHOOK_SECRET is missing. Copy backend/.env.example to .env.",
        );
    }

    return secret;
})();

export function createPool(): Pool {
    return new Pool({ connectionString: process.env.DATABASE_URL });
}

/**
 * Each test creates its own product so tests never fight over seeded stock
 * and can run in any order.
 */
export async function createTestProduct(
    pool: Pool,
    options: { label: string; pricePaise: number; stock: number },
): Promise<string> {
    const result = await pool.query<{ id: string }>(
        `INSERT INTO products (name, price_paise, stock)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [`${options.label} ${randomUUID()}`, options.pricePaise, options.stock],
    );

    return result.rows[0]!.id;
}

/** Removes a test product and everything that references it. */
export async function deleteTestProduct(
    pool: Pool,
    productId: string,
): Promise<void> {
    const orders = await pool.query<{ order_id: string }>(
        `SELECT DISTINCT order_id FROM order_items WHERE product_id = $1`,
        [productId],
    );

    const orderIds = orders.rows.map((row) => row.order_id);

    if (orderIds.length > 0) {
        await pool.query(
            `DELETE FROM webhook_events WHERE order_id = ANY($1::uuid[])`,
            [orderIds],
        );

        // Deleting the orders cascades to order_items.
        await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
            orderIds,
        ]);
    }

    await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
}

export type OrderResponse = {
    id: string;
    status: string;
    totalPaise: number;
    expiresInSeconds: number;
    serverTime: string;
};

export async function placeOrder(
    productId: string,
    quantity = 1,
): Promise<Response> {
    return fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ productId, quantity }] }),
    });
}

export async function placeOrderOk(
    productId: string,
    quantity = 1,
): Promise<OrderResponse> {
    const response = await placeOrder(productId, quantity);

    if (response.status !== 201) {
        throw new Error(
            `Expected 201 from POST /orders, got ${response.status}: ` +
                `${await response.text()}`,
        );
    }

    const body = (await response.json()) as { order: OrderResponse };

    return body.order;
}

export function sign(rawBody: string, secret = webhookSecret): string {
    return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Posts a webhook signed exactly the way the provider would sign it: the
 * HMAC is over the raw bytes that are sent, not over a re-serialised object.
 */
export async function sendWebhook(options: {
    eventId?: string;
    orderId: string;
    amountPaise: number;
    status?: "captured" | "failed";
    signature?: string;
}): Promise<Response> {
    const payload = {
        eventId: options.eventId ?? `evt_${randomUUID()}`,
        orderId: options.orderId,
        amountPaise: options.amountPaise,
        status: options.status ?? "captured",
    };

    const rawBody = JSON.stringify(payload);

    return fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Signature": options.signature ?? sign(rawBody),
        },
        body: rawBody,
    });
}

export async function getOrderStatus(orderId: string): Promise<string> {
    const response = await fetch(`${baseUrl}/orders/${orderId}`);
    const body = (await response.json()) as { order: { status: string } };

    return body.order.status;
}

export async function getStock(pool: Pool, productId: string): Promise<number> {
    const result = await pool.query<{ stock: number }>(
        `SELECT stock FROM products WHERE id = $1`,
        [productId],
    );

    return result.rows[0]!.stock;
}

/** Available units as GET /products reports them. */
export async function getAvailable(
    productId: string,
): Promise<number | undefined> {
    const response = await fetch(`${baseUrl}/products`);
    const body = (await response.json()) as {
        products: { id: string; availableStock: number }[];
    };

    return body.products.find((product) => product.id === productId)
        ?.availableStock;
}
