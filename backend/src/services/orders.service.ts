import { z } from "zod";
import { pool, withTransaction } from "../config/db.js";
import { env } from "../config/env.js";
import { HELD_UNITS_BY_PRODUCT_SQL } from "../db/holds.js";
import { badRequest, conflict, notFound } from "../http/errors.js";

export const createOrderSchema = z.object({
    items: z
        .array(
            z.object({
                productId: z.string().uuid("productId must be a UUID"),
                quantity: z.number().int().positive().max(100),
            }),
        )
        .min(1, "An order needs at least one item")
        .max(50),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const orderIdSchema = z.string().uuid("A valid order ID is required");

type OrderRow = {
    id: string;
    status: string;
    totalPaise: number;
    createdAt: Date;
    expiresAt: Date;
    paidAt: Date | null;
    claimedAt: Date | null;
    expiresInSeconds: number;
    serverTime: Date;
};

/**
 * `expiresInSeconds` is the seconds left on the hold, measured by the
 * database clock at the moment the row is read. Both the browser's clock and
 * the counter's clock are untrusted, so this number is the only thing the
 * customer screen counts down from.
 */
const ORDER_COLUMNS_SQL = `
    id,
    status,
    total_paise AS "totalPaise",
    created_at AS "createdAt",
    expires_at AS "expiresAt",
    paid_at AS "paidAt",
    claimed_at AS "claimedAt",
    GREATEST(
        0,
        CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())))
    )::int AS "expiresInSeconds",
    clock_timestamp() AS "serverTime"`;

export async function createOrder(input: CreateOrderInput) {
    const items = input.items;
    const productIds = items.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
        throw badRequest(
            "DUPLICATE_PRODUCTS",
            "Each product may appear only once in an order.",
        );
    }

    return withTransaction(async (client) => {
        // Lock the product rows in a deterministic order. Two concurrent
        // orders for the same product serialise here, which is what keeps
        // the availability check below from being a read-modify-write race.
        const lockedProducts = await client.query<{
            id: string;
            name: string;
            price_paise: number;
            stock: number;
        }>(
            `SELECT id, name, price_paise, stock
               FROM products
              WHERE id = ANY($1::uuid[]) AND active = TRUE
              ORDER BY id
                FOR UPDATE`,
            [productIds],
        );

        if (lockedProducts.rows.length !== items.length) {
            throw badRequest(
                "PRODUCT_NOT_FOUND",
                "One or more products do not exist or are inactive.",
            );
        }

        const productById = new Map(
            lockedProducts.rows.map((product) => [product.id, product]),
        );

        const heldResult = await client.query<{
            product_id: string;
            held: number;
        }>(HELD_UNITS_BY_PRODUCT_SQL, [productIds]);

        const heldById = new Map(
            heldResult.rows.map((row) => [row.product_id, row.held]),
        );

        // Nothing is written until every line passes, so a failed order
        // holds no stock at all.
        for (const item of items) {
            const product = productById.get(item.productId)!;
            const available = Math.max(
                product.stock - (heldById.get(item.productId) ?? 0),
                0,
            );

            if (item.quantity > available) {
                throw conflict(
                    "INSUFFICIENT_STOCK",
                    `Not enough stock for ${product.name}. ${available} left.`,
                    { productId: product.id, availableStock: available },
                );
            }
        }

        const totalPaise = items.reduce(
            (total, item) =>
                total +
                productById.get(item.productId)!.price_paise * item.quantity,
            0,
        );

        if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
            throw badRequest("INVALID_TOTAL", "Order total is invalid.");
        }

        const orderResult = await client.query<OrderRow>(
            `INSERT INTO orders (total_paise, expires_at)
             VALUES ($1, clock_timestamp() + ($2 || ' seconds')::interval)
             RETURNING ${ORDER_COLUMNS_SQL}`,
            [totalPaise, env.HOLD_SECONDS],
        );

        const order = orderResult.rows[0]!;

        // One multi-row INSERT rather than one round trip per line.
        await client.query(
            `INSERT INTO order_items
                 (order_id, product_id, quantity, unit_price_paise)
             SELECT $1, item.product_id, item.quantity, item.unit_price
               FROM UNNEST($2::uuid[], $3::int[], $4::int[])
                 AS item(product_id, quantity, unit_price)`,
            [
                order.id,
                productIds,
                items.map((item) => item.quantity),
                items.map((item) => productById.get(item.productId)!.price_paise),
            ],
        );

        return {
            ...order,
            items: items.map((item) => {
                const product = productById.get(item.productId)!;

                return {
                    productId: product.id,
                    name: product.name,
                    quantity: item.quantity,
                    unitPricePaise: product.price_paise,
                    lineTotalPaise: product.price_paise * item.quantity,
                };
            }),
        };
    });
}

/**
 * Reads an order, expiring it first if its hold has run out.
 *
 * Expiry is lazy rather than driven by a background job: an order is expired
 * the moment `expires_at` passes, because every query that counts held units
 * filters on `expires_at > clock_timestamp()`. Read paths then settle the
 * stored status so the customer sees `expired` rather than `pending`.
 */
export async function getOrder(orderId: string) {
    // The UPDATE's output is read back through the CTE rather than from
    // `orders` directly: a plain `SELECT ... FROM orders` in the same
    // statement would see the pre-UPDATE snapshot and still report
    // 'pending'. The UNION ALL branch covers the case where nothing needed
    // expiring (including a missing order).
    const result = await pool.query<OrderRow>(
        `WITH settled AS (
             UPDATE orders
                SET status = 'expired'
              WHERE id = $1
                AND status = 'pending'
                AND expires_at <= clock_timestamp()
             RETURNING ${ORDER_COLUMNS_SQL}
         )
         SELECT * FROM settled
         UNION ALL
         SELECT ${ORDER_COLUMNS_SQL}
           FROM orders
          WHERE id = $1
            AND NOT EXISTS (SELECT 1 FROM settled)`,
        [orderId],
    );

    const order = result.rows[0];

    if (!order) {
        throw notFound("ORDER_NOT_FOUND", "Order not found.");
    }

    const itemsResult = await pool.query(
        `SELECT
             oi.product_id AS "productId",
             p.name,
             oi.quantity,
             oi.unit_price_paise AS "unitPricePaise",
             (oi.quantity * oi.unit_price_paise) AS "lineTotalPaise"
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
          ORDER BY p.name`,
        [orderId],
    );

    return { ...order, items: itemsResult.rows };
}

export type ClaimResult = {
    orderId: string;
    status: "claimed";
    claimedAt: Date;
};

/**
 * Why the claim did not succeed. These are returned rather than thrown from
 * inside the transaction: an expired order has its stored status settled as
 * part of the same transaction, and throwing there would roll that write
 * back along with the error.
 */
type ClaimOutcome =
    | { kind: "claimed"; claimedAt: Date }
    | { kind: "not_found" }
    | { kind: "already_claimed" }
    | { kind: "expired" }
    | { kind: "payment_required" }
    | { kind: "not_claimable"; status: string };

/**
 * Collects a paid order from the locker and permanently reduces stock.
 *
 * Two lockers calling this at the same instant both reach the `FOR UPDATE`;
 * one wins and flips the status to 'claimed', and the other then reads
 * 'claimed' and gets a 409. The conditional `WHERE status = 'paid'` on the
 * final UPDATE is a second guard, so a double claim cannot decrement stock
 * twice even if the lock were ever lost.
 */
export async function claimPickup(orderId: string): Promise<ClaimResult> {
    const outcome = await withTransaction<ClaimOutcome>(async (client) => {
        const orderResult = await client.query<{
            id: string;
            status: string;
            is_expired: boolean;
        }>(
            `SELECT
                 id,
                 status,
                 expires_at <= clock_timestamp() AS is_expired
               FROM orders
              WHERE id = $1
                FOR UPDATE`,
            [orderId],
        );

        const order = orderResult.rows[0];

        if (!order) return { kind: "not_found" };

        if (order.status === "claimed") return { kind: "already_claimed" };

        if (order.status === "pending") {
            if (!order.is_expired) return { kind: "payment_required" };

            // Settle the stored status while the row is still locked, so the
            // next read does not have to work it out again.
            await client.query(
                `UPDATE orders
                    SET status = 'expired'
                  WHERE id = $1 AND status = 'pending'`,
                [orderId],
            );

            return { kind: "expired" };
        }

        if (order.status !== "paid") {
            return { kind: "not_claimable", status: order.status };
        }

        const itemsResult = await client.query<{
            product_id: string;
            quantity: number;
        }>(
            `SELECT product_id, quantity
               FROM order_items
              WHERE order_id = $1
              ORDER BY product_id`,
            [orderId],
        );

        // The claim is where stock leaves the counter for good. These units
        // have been held continuously since the order was created, so this
        // cannot take stock below zero; the column CHECK enforces that
        // regardless of what the application believes.
        const decremented = await client.query(
            `UPDATE products AS p
                SET stock = p.stock - item.quantity
               FROM UNNEST($1::uuid[], $2::int[]) AS item(product_id, quantity)
              WHERE p.id = item.product_id`,
            [
                itemsResult.rows.map((item) => item.product_id),
                itemsResult.rows.map((item) => item.quantity),
            ],
        );

        if (decremented.rowCount !== itemsResult.rows.length) {
            // A genuine inconsistency: roll the whole claim back.
            throw conflict(
                "STOCK_UPDATE_FAILED",
                "Could not reduce stock for every item in this order.",
            );
        }

        const claimed = await client.query<{ claimed_at: Date }>(
            `UPDATE orders
                SET status = 'claimed',
                    claimed_at = clock_timestamp()
              WHERE id = $1 AND status = 'paid'
             RETURNING claimed_at`,
            [orderId],
        );

        if (claimed.rowCount !== 1) {
            // The row was locked, so this should be unreachable; if it ever
            // happens, the stock decrement above must not stand.
            throw conflict(
                "ALREADY_CLAIMED",
                "This order has already been collected.",
            );
        }

        return { kind: "claimed", claimedAt: claimed.rows[0]!.claimed_at };
    });

    // Mapped after the commit, so the settled status survives the error.
    switch (outcome.kind) {
        case "claimed":
            return {
                orderId,
                status: "claimed",
                claimedAt: outcome.claimedAt,
            };
        case "not_found":
            throw notFound("ORDER_NOT_FOUND", "Order not found.");
        case "already_claimed":
            throw conflict(
                "ALREADY_CLAIMED",
                "This order has already been collected.",
            );
        case "expired":
            throw conflict(
                "ORDER_EXPIRED",
                "This order's hold expired before it was paid.",
            );
        case "payment_required":
            throw conflict(
                "PAYMENT_REQUIRED",
                "Payment must be confirmed before pickup.",
            );
        case "not_claimable":
            throw conflict(
                "ORDER_NOT_CLAIMABLE",
                `An order with status '${outcome.status}' cannot be collected.`,
            );
    }
}
