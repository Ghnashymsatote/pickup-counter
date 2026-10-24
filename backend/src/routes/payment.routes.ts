import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../config/db.js";
import { env } from "../config/env.js";
import { asyncHandler, badRequest, notFound } from "../http/errors.js";
import {
    paymentWebhookSchema,
    processPaymentEvent,
    signPayload,
    verifyWebhookSignature,
} from "../services/payments.service.js";
import { orderIdSchema } from "../services/orders.service.js";

const router = Router();

/**
 * The endpoint the payment provider calls. Signature first, then schema,
 * then processing: an unsigned request is rejected before its body is
 * trusted for anything at all.
 */
router.post(
    "/webhook",
    asyncHandler(async (req, res) => {
        verifyWebhookSignature(req.rawBody, req.header("X-Signature"));

        const parsed = paymentWebhookSchema.safeParse(req.body);

        if (!parsed.success) {
            throw badRequest(
                "INVALID_WEBHOOK",
                "Provide a valid event ID, order ID, amount and payment status.",
                {
                    issues: parsed.error.issues.map((issue) => ({
                        path: issue.path.join("."),
                        message: issue.message,
                    })),
                },
            );
        }

        res.json(await processPaymentEvent(parsed.data));
    }),
);

/**
 * Convenience endpoint for the customer screen's "Pay with UPI" button.
 *
 * There is no real payment provider in this assignment, so this signs a
 * capture event for the order's exact total and puts it through the very same
 * verification and processing path as a real webhook. It is gated behind
 * ENABLE_PAYMENT_SIMULATION so it can never become a way to mark orders paid
 * for free where real money is involved.
 */
router.post(
    "/simulate/:orderId",
    asyncHandler(async (req, res) => {
        if (!env.ENABLE_PAYMENT_SIMULATION) {
            throw notFound(
                "NOT_AVAILABLE",
                "Payment simulation is unavailable.",
            );
        }

        const parsed = orderIdSchema.safeParse(req.params.orderId);

        if (!parsed.success) {
            throw badRequest(
                "INVALID_ORDER_ID",
                "A valid order ID is required.",
            );
        }

        const result = await pool.query<{ total_paise: number }>(
            `SELECT total_paise FROM orders WHERE id = $1`,
            [parsed.data],
        );

        if (result.rows.length === 0) {
            throw notFound("ORDER_NOT_FOUND", "Order not found.");
        }

        const payload = {
            eventId: `evt_sim_${randomUUID()}`,
            orderId: parsed.data,
            amountPaise: Number(result.rows[0]!.total_paise),
            status: "captured" as const,
        };

        const rawBody = Buffer.from(JSON.stringify(payload));

        verifyWebhookSignature(rawBody, signPayload(rawBody));

        res.json(await processPaymentEvent(paymentWebhookSchema.parse(payload)));
    }),
);

export default router;
