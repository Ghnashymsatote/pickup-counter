import { Router } from "express";
import { pool } from "../config/db.js";
import { z } from "zod";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import express from "express";
const router = Router();

const paymentWebhookSchema = z.object({
    eventId: z.string().min(1).max(200),
    orderId: z.string().uuid(),
    amountPaise: z.number().int().positive(),
    status: z.enum(["captured", "failed"]),
});
// LOCAL ASSIGNMENT SIMULATION ONLY.
// A production webhook must verify the payment provider's signature.
const handlePaymentWebhook = async (
    req: express.Request & { rawBody?: Buffer },
    res: express.Response,
) => {

    const rawBody = (
        req as express.Request & { rawBody?: Buffer }
    ).rawBody;

   const simulatedSignature = (
    req as express.Request & { simulatedSignature?: string }
).simulatedSignature;

const signature =
    simulatedSignature ?? req.header("X-Signature");
    const secret = process.env.WEBHOOK_SECRET;

    if (!rawBody || !signature || !secret) {
        res.status(401).json({
            error: "INVALID_SIGNATURE",
            message: "Webhook signature or secret is missing.",
        });
        return;
    }

    const expectedSignature = createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (
        !/^[a-fA-F0-9]{64}$/.test(signature) ||
        signatureBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
        res.status(401).json({
            error: "INVALID_SIGNATURE",
            message: "Webhook signature verification failed.",
        });
        return;
    }

    const parsed = paymentWebhookSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "INVALID_WEBHOOK",
            message: "Provide a valid event ID, order ID, amount, and payment status.",
        });
        return;
    }

    const event = {
        eventId: parsed.data.eventId,
        orderId: parsed.data.orderId,
        amountPaise: parsed.data.amountPaise,
        paymentStatus:
            parsed.data.status === "captured" ? "succeeded" : "failed",
    };
    const client = await pool.connect();
    let transactionStarted = false;

    try {
        await client.query("BEGIN");
        transactionStarted = true;

        const orderResult = await client.query<{
            id: string;
            status: string;
            total_paise: number;
            expires_at: Date;
            is_unexpired: boolean;
        }>(
            `SELECT
         id,
         status,
         total_paise,
         expires_at,
         expires_at > clock_timestamp() AS is_unexpired
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
            [event.orderId],
        );

        if (orderResult.rows.length === 0) {
            await client.query("ROLLBACK");
            transactionStarted = false;

            res.status(404).json({
                error: "ORDER_NOT_FOUND",
                message: "Order not found.",
            });
            return;
        }

        const order = orderResult.rows[0]!;

        const insertedEvent = await client.query(
            `INSERT INTO webhook_events
         (event_id, order_id, amount_paise, payment_status, outcome)
       VALUES ($1, $2, $3, $4, 'processing')
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
            [
                event.eventId,
                event.orderId,
                event.amountPaise,
                event.paymentStatus,
            ],
        );

        if (insertedEvent.rows.length === 0) {
            const previousEvent = await client.query<{
                order_id: string;
                amount_paise: number;
                payment_status: string;
                outcome: string;
            }>(
                `SELECT
           order_id,
           amount_paise,
           payment_status,
           outcome
         FROM webhook_events
         WHERE event_id = $1`,
                [event.eventId],
            );

            const previous = previousEvent.rows[0];

            if (
                !previous ||
                previous.order_id !== event.orderId ||
                previous.amount_paise !== event.amountPaise ||
                previous.payment_status !== event.paymentStatus
            ) {
                await client.query("ROLLBACK");
                transactionStarted = false;

                res.status(409).json({
                    error: "EVENT_ID_CONFLICT",
                    message: "This event ID was already used with different data.",
                });
                return;
            }

            await client.query("COMMIT");
            transactionStarted = false;

            res.json({
                received: true,
                duplicate: true,
                outcome: previous.outcome,
            });
            return;
        }

        let outcome: string;

        if (event.amountPaise !== order.total_paise) {
            if (order.status === "pending" || order.status === "expired") {
                await client.query(
                    `UPDATE orders SET status = 'needs_review' WHERE id = $1`,
                    [order.id],
                );
            }

            outcome = "amount_mismatch";
        } else if (event.paymentStatus === "failed") {
            if (order.status === "pending" && !order.is_unexpired) {
                await client.query(
                    `UPDATE orders SET status = 'expired' WHERE id = $1`,
                    [order.id],
                );
                outcome = "payment_failed_order_expired";
            } else {
                outcome = "payment_failed";
            }
        } else if (
            order.status === "expired" ||
            (order.status === "pending" && !order.is_unexpired)
        ) {
            await client.query(
                `UPDATE orders
         SET status = 'needs_review'
         WHERE id = $1 AND status IN ('pending', 'expired')`,
                [order.id],
            );

            outcome = "late_payment_needs_review";
        } else if (order.status !== "pending") {
            outcome =
                order.status === "paid" || order.status === "claimed"
                    ? "already_paid"
                    : "order_needs_review";
        } else {
            const itemsResult = await client.query<{
                product_id: string;
                quantity: number;
            }>(
                `SELECT product_id, quantity
         FROM order_items
         WHERE order_id = $1
         ORDER BY product_id`,
                [order.id],
            );

            const productIds = itemsResult.rows.map((item) => item.product_id);

            const productsResult = await client.query<{
                id: string;
                stock: number;
            }>(
                `SELECT id, stock
         FROM products
         WHERE id = ANY($1::uuid[])
         ORDER BY id
         FOR UPDATE`,
                [productIds],
            );

            const stockById = new Map(
                productsResult.rows.map((product) => [product.id, product.stock]),
            );

            const stockIsSufficient =
                itemsResult.rows.length > 0 &&
                productsResult.rows.length === itemsResult.rows.length &&
                itemsResult.rows.every(
                    (item) =>
                        (stockById.get(item.product_id) ?? -1) >= item.quantity,
                );

            if (!stockIsSufficient) {
                await client.query(
                    `UPDATE orders SET status = 'needs_review' WHERE id = $1`,
                    [order.id],
                );

                outcome = "stock_unavailable_needs_review";
            } else {
                for (const item of itemsResult.rows) {
                    await client.query(
                        `UPDATE products
             SET stock = stock - $1
             WHERE id = $2`,
                        [item.quantity, item.product_id],
                    );
                }

                await client.query(
                    `UPDATE orders
           SET status = 'paid', paid_at = clock_timestamp()
           WHERE id = $1 AND status = 'pending'`,
                    [order.id],
                );

                outcome = "payment_succeeded";
            }
        }

        await client.query(
            `UPDATE webhook_events SET outcome = $1 WHERE event_id = $2`,
            [outcome, event.eventId],
        );

        await client.query("COMMIT");
        transactionStarted = false;

        res.json({
            received: true,
            duplicate: false,
            outcome,
        });
    } catch (error) {
        if (transactionStarted) {
            await client.query("ROLLBACK").catch((rollbackError: unknown) => {
                console.error("Payment webhook rollback failed:", rollbackError);
            });
        }

        console.error("Payment webhook failed:", error);

        res.status(500).json({
            error: "INTERNAL_SERVER_ERROR",
            message: "Could not process payment event.",
        });
    } finally {
        client.release();
    }
};

router.post("/webhook", handlePaymentWebhook);

router.post("/simulate/:orderId", async (req, res) => {
    // Never allow simulated payments in production.
    if (process.env.NODE_ENV === "production") {
        res.status(404).json({
            message: "Payment simulation is unavailable.",
        });
        return;
    }

    const params = z.object({
        orderId: z.string().uuid(),
    }).safeParse(req.params);

    if (!params.success) {
        res.status(400).json({ message: "Invalid order ID." });
        return;
    }

    const secret = process.env.WEBHOOK_SECRET;

    if (!secret) {
        res.status(500).json({
            message: "WEBHOOK_SECRET is not configured.",
        });
        return;
    }

    try {
        const result = await pool.query<{
            total_paise: number | string;
        }>(
            `SELECT total_paise FROM orders WHERE id = $1`,
            [params.data.orderId],
        );

        if (result.rows.length === 0) {
            res.status(404).json({ message: "Order not found." });
            return;
        }

        const amountPaise = Number(result.rows[0]!.total_paise);

        if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
            res.status(400).json({
                message: "Order amount is invalid for payment simulation.",
            });
            return;
        }

        const payload = {
            eventId: randomUUID(),
            orderId: params.data.orderId,
            amountPaise,
            status: "captured" as const,
        };

        const rawBody = Buffer.from(JSON.stringify(payload));
        const signature = createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex");

        // Pass the signed simulation through the existing webhook logic.
      const simulatedReq = Object.create(req) as express.Request & {
    rawBody?: Buffer;
    simulatedSignature?: string;
};
   simulatedReq.body = payload;
simulatedReq.rawBody = rawBody;
simulatedReq.simulatedSignature = signature;


        await handlePaymentWebhook(simulatedReq, res);
    } catch (error) {
        console.error("Payment simulation failed:", error);

        if (!res.headersSent) {
            res.status(500).json({
                message: "Could not simulate payment.",
            });
        }
    }
});

// We will move the existing payment webhook logic here.

export default router;