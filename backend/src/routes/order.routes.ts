import { Router } from "express";
import { pool } from "../config/db.js";
import { z } from "zod";

const router = Router();

const createOrderSchema = z.object({
    items: z
        .array(
            z.object({
                productId: z.string().uuid(),
                quantity: z.number().int().positive().max(100),
            }),
        )
        .min(1)
        .max(50),
});
router.post("/", async (req, res) => {
    const parsed = createOrderSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "INVALID_REQUEST",
            message: "Provide valid product IDs and positive integer quantities.",
        });
        return;
    }

    const items = parsed.data.items;
    const productIds = items.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
        res.status(400).json({
            error: "DUPLICATE_PRODUCTS",
            message: "Each product may appear only once in an order.",
        });
        return;
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
        await client.query("BEGIN");
        transactionStarted = true;

        // Lock selected products in a consistent order so concurrent
        // orders cannot reserve the same stock.
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
            await client.query("ROLLBACK");
            transactionStarted = false;

            res.status(400).json({
                error: "PRODUCT_NOT_FOUND",
                message: "One or more products do not exist or are inactive.",
            });
            return;
        }

        const productMap = new Map(
            lockedProducts.rows.map((product) => [product.id, product]),
        );

        const reservationCheck = await client.query<{
            product_id: string;
            reserved: number;
        }>(
            `SELECT oi.product_id, COALESCE(SUM(oi.quantity), 0)::int AS reserved
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id = ANY($1::uuid[])
         AND o.status = 'pending'
         AND o.expires_at > NOW()
       GROUP BY oi.product_id`,
            [productIds],
        );

        const reservedMap = new Map(
            reservationCheck.rows.map((row) => [row.product_id, row.reserved]),
        );

        for (const item of items) {
            const product = productMap.get(item.productId)!;
            const reserved = reservedMap.get(item.productId) ?? 0;
            const available = Math.max(product.stock - reserved, 0);

            if (item.quantity > available) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                res.status(409).json({
                    error: "INSUFFICIENT_STOCK",
                    message: `Not enough stock for ${product.name}.`,
                    productId: product.id,
                    availableStock: available,
                });
                return;
            }
        }

        const totalPaise = items.reduce((total, item) => {
            const product = productMap.get(item.productId)!;
            return total + product.price_paise * item.quantity;
        }, 0);

        if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
            await client.query("ROLLBACK");
            transactionStarted = false;

            res.status(400).json({
                error: "INVALID_TOTAL",
                message: "Order total is invalid.",
            });
            return;
        }


        const orderResult = await client.query<{
            id: string;
            status: string;
            total_paise: number;
            created_at: Date;
            expires_at: Date;
            expires_in_seconds: number;
        }>(
            `INSERT INTO orders (total_paise, expires_at)
   VALUES ($1, clock_timestamp() + INTERVAL '120 seconds')
   RETURNING
     id,
     status,
     total_paise,
     created_at,
     expires_at,
     GREATEST(
       0,
       CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())))
     )::int AS expires_in_seconds`,
            [totalPaise],
        );


        const order = orderResult.rows[0]!;

        for (const item of items) {
            const product = productMap.get(item.productId)!;

            await client.query(
                `INSERT INTO order_items
           (order_id, product_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4)`,
                [order.id, product.id, item.quantity, product.price_paise],
            );
        }

        await client.query("COMMIT");
        transactionStarted = false;

        res.status(201).json({
            order: {
                id: order.id,
                status: order.status,
                totalPaise: order.total_paise,
                createdAt: order.created_at,
                expiresAt: order.expires_at,
                expiresInSeconds: order.expires_in_seconds,
                items: items.map((item) => {
                    const product = productMap.get(item.productId)!;

                    return {
                        productId: product.id,
                        name: product.name,
                        quantity: item.quantity,
                        unitPricePaise: product.price_paise,
                        lineTotalPaise: product.price_paise * item.quantity,
                    };
                }),
            },
        });
    } catch (error) {
        if (transactionStarted) {
            await client.query("ROLLBACK").catch((rollbackError: unknown) => {
                console.error("Order rollback failed:", rollbackError);
            });
        }

        console.error("Failed to create order:", error);

        res.status(500).json({
            error: "INTERNAL_SERVER_ERROR",
            message: "Could not create order.",
        });
    } finally {
        client.release();
    }
});

router.get("/:id", async (req, res) => {
    const orderId = req.params.id;

    if (!z.string().uuid().safeParse(orderId).success) {
        res.status(400).json({
            error: "INVALID_ORDER_ID",
            message: "A valid order ID is required.",
        });
        return;
    }

    try {

        const orderResult = await pool.query(
            `UPDATE orders
   SET status = 'expired'
   WHERE id = $1
     AND status = 'pending'
     AND expires_at <= NOW()
   RETURNING
     id,
     status,
     total_paise AS "totalPaise",
     created_at AS "createdAt",
     expires_at AS "expiresAt",
     paid_at AS "paidAt",
     claimed_at AS "claimedAt"`,
            [orderId],
        );

        if (orderResult.rows.length === 0) {
            const existingOrder = await pool.query(
                `SELECT
       id,
       status,
       total_paise AS "totalPaise",
       created_at AS "createdAt",
       expires_at AS "expiresAt",
       paid_at AS "paidAt",
       claimed_at AS "claimedAt"
     FROM orders
     WHERE id = $1`,
                [orderId],
            );

            if (existingOrder.rows.length === 0) {
                res.status(404).json({
                    error: "ORDER_NOT_FOUND",
                    message: "Order not found.",
                });
                return;
            }

            orderResult.rows.push(existingOrder.rows[0]);
        }


        if (orderResult.rows.length === 0) {
            res.status(404).json({
                error: "ORDER_NOT_FOUND",
                message: "Order not found.",
            });
            return;
        }

        const itemsResult = await pool.query(
            `SELECT
         oi.product_id AS "productId",
         p.name,
         oi.quantity,
         oi.unit_price_paise AS "unitPricePaise"
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY p.name`,
            [orderId],
        );

        res.json({
            order: {
                ...orderResult.rows[0],
                items: itemsResult.rows,
            },
        });
    } catch (error) {
        console.error("Failed to fetch order:", error);

        res.status(500).json({
            error: "INTERNAL_SERVER_ERROR",
            message: "Could not fetch order.",
        });
    }
});


router.post("/:id/pickup-claim", async (req, res) => {
    const orderId = req.params.id;

    if (!z.string().uuid().safeParse(orderId).success) {
        res.status(400).json({
            error: "INVALID_ORDER_ID",
            message: "A valid order ID is required.",
        });
        return;
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
        await client.query("BEGIN");
        transactionStarted = true;

        // Lock the order row. Concurrent claims must wait for this lock.
        const result = await client.query<{
            id: string;
            status: string;
            expires_at: Date;
        }>(
            `SELECT id, status, expires_at
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
            [orderId],
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            transactionStarted = false;

            res.status(404).json({
                error: "ORDER_NOT_FOUND",
                message: "Order not found.",
            });
            return;
        }

        const order = result.rows[0]!;

        if (order.status === "claimed") {
            await client.query("ROLLBACK");
            transactionStarted = false;

            res.status(409).json({
                error: "ALREADY_CLAIMED",
                message: "This order has already been claimed.",
            });
            return;
        }

        if (order.status === "pending") {
            if (new Date(order.expires_at).getTime() <= Date.now()) {
                await client.query(
                    `UPDATE orders SET status = 'expired'
           WHERE id = $1 AND status = 'pending'`,
                    [orderId],
                );

                await client.query("COMMIT");
                transactionStarted = false;

                res.status(409).json({
                    error: "ORDER_EXPIRED",
                    message: "This order has expired.",
                });
                return;
            }

            await client.query("ROLLBACK");
            transactionStarted = false;

            res.status(409).json({
                error: "PAYMENT_REQUIRED",
                message: "Payment must succeed before pickup.",
            });
            return;
        }

        if (order.status !== "paid") {
            await client.query("ROLLBACK");
            transactionStarted = false;

            res.status(409).json({
                error: "ORDER_NOT_CLAIMABLE",
                message: `This order cannot be claimed while its status is '${order.status}'.`,
            });
            return;
        }

        await client.query(
            `UPDATE orders
       SET status = 'claimed',
           claimed_at = clock_timestamp()
       WHERE id = $1 AND status = 'paid'`,
            [orderId],
        );

        await client.query("COMMIT");
        transactionStarted = false;

        res.json({
            success: true,
            orderId,
            status: "claimed",
            message: "Pickup claim successful.",
        });
    } catch (error) {
        if (transactionStarted) {
            await client.query("ROLLBACK").catch((rollbackError: unknown) => {
                console.error("Pickup claim rollback failed:", rollbackError);
            });
        }

        console.error("Pickup claim failed:", error);

        res.status(500).json({
            error: "INTERNAL_SERVER_ERROR",
            message: "Could not claim this order.",
        });
    } finally {
        client.release();
    }
});




// We will move the order creation, order details,
// and pickup-claim endpoints into this file.

export default router;