import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";

import {
    baseUrl,
    createPool,
    createTestProduct,
    deleteTestProduct,
    placeOrder,
    placeOrderOk,
} from "./helpers";

describe("The real database", () => {
    it("is the assignment database, and reports its own clock", async () => {
        const pool = createPool();

        try {
            const result = await pool.query<{
                database_name: string;
                database_time: Date;
            }>(
                `SELECT current_database() AS database_name,
                        clock_timestamp() AS database_time`,
            );

            expect(result.rows[0]!.database_name).toBe("pickup_counter");
            expect(result.rows[0]!.database_time).toBeInstanceOf(Date);
        } finally {
            await pool.end();
        }
    });
});

describe("GET /products", () => {
    it("returns the seeded catalogue with prices in whole paise", async () => {
        const response = await fetch(`${baseUrl}/products`);

        expect(response.status).toBe(200);

        const body = (await response.json()) as {
            products: {
                id: string;
                name: string;
                pricePaise: number;
                availableStock: number;
            }[];
        };

        expect(body.products.length).toBeGreaterThanOrEqual(5);

        for (const product of body.products) {
            // Money is integer paise everywhere; a fractional value here
            // would mean rupees had leaked in as a float.
            expect(Number.isInteger(product.pricePaise)).toBe(true);
            expect(product.pricePaise).toBeGreaterThan(0);
            expect(Number.isInteger(product.availableStock)).toBe(true);
            expect(product.availableStock).toBeGreaterThanOrEqual(0);
        }
    });
});

describe("POST /orders", () => {
    let pool: Pool;
    let productId: string;

    beforeAll(async () => {
        pool = createPool();
        productId = await createTestProduct(pool, {
            label: "Order Test",
            pricePaise: 1999,
            stock: 20,
        });
    });

    afterAll(async () => {
        await deleteTestProduct(pool, productId);
        await pool.end();
    });

    it("totals the order in paise, with no floating point", async () => {
        const order = await placeOrderOk(productId, 3);

        expect(order.totalPaise).toBe(1999 * 3);
        expect(Number.isInteger(order.totalPaise)).toBe(true);
        expect(order.status).toBe("pending");
    });

    it("rejects an unknown product", async () => {
        const response = await placeOrder(
            "00000000-0000-4000-8000-000000000000",
            1,
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            error: "PRODUCT_NOT_FOUND",
        });
    });

    it("rejects bad input instead of guessing", async () => {
        const cases = [
            {},
            { items: [] },
            { items: [{ productId, quantity: 0 }] },
            { items: [{ productId, quantity: -1 }] },
            { items: [{ productId, quantity: 1.5 }] },
            { items: [{ productId, quantity: "1" }] },
            { items: [{ productId: "nope", quantity: 1 }] },
            // The same product twice would make the hold ambiguous.
            {
                items: [
                    { productId, quantity: 1 },
                    { productId, quantity: 1 },
                ],
            },
        ];

        for (const body of cases) {
            const response = await fetch(`${baseUrl}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            expect(response.status, JSON.stringify(body)).toBe(400);
        }
    });

    it("answers malformed JSON with JSON, not an HTML error page", async () => {
        const response = await fetch(`${baseUrl}/orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{ this is not json",
        });

        expect(response.status).toBe(400);
        expect(response.headers.get("content-type")).toContain(
            "application/json",
        );
        expect(await response.json()).toMatchObject({
            error: "MALFORMED_JSON",
        });
    });

    it("404s an unknown route as JSON", async () => {
        const response = await fetch(`${baseUrl}/no-such-route`);

        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({
            error: "ROUTE_NOT_FOUND",
        });
    });
});
