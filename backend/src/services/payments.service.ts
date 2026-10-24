import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withTransaction } from "../config/db.js";
import { env } from "../config/env.js";
import { conflict, notFound, unauthorized } from "../http/errors.js";

export const paymentWebhookSchema = z.object({
    eventId: z.string().min(1).max(200),
    orderId: z.string().uuid(),
    amountPaise: z.number().int().positive(),
    status: z.enum(["captured", "failed"]),
});

export type PaymentWebhookBody = z.infer<typeof paymentWebhookSchema>;

const HEX_SHA256 = /^[a-f0-9]{64}$/i;

export function signPayload(rawBody: Buffer | string): string {
    return createHmac("sha256", env.WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");
}

/**
 * Verifies `X-Signature` against an HMAC-SHA256 of the *raw* request body.
 *
 * It has to be the raw bytes, not `JSON.stringify(req.body)`: re-serialising
 * reorders keys and changes whitespace, which would make every genuine
 * signature fail. `app.ts` captures the raw buffer during JSON parsing.
 */
export function verifyWebhookSignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
): void {
    if (!rawBody || rawBody.length === 0 || !signature) {
        throw unauthorized(
            "INVALID_SIGNATURE",
            "Webhook signature or request body is missing.",
        );
    }

    if (!HEX_SHA256.test(signature)) {
        throw unauthorized(
            "INVALID_SIGNATURE",
            "Webhook signature is not a hex SHA-256 digest.",
        );
    }

    const provided = Buffer.from(signature, "hex");
    const expected = Buffer.from(signPayload(rawBody), "hex");

    // Lengths are equal by construction above, so timingSafeEqual is safe to
    // call and the comparison stays constant-time.
    if (!timingSafeEqual(provided, expected)) {
        throw unauthorized(
            "INVALID_SIGNATURE",
            "Webhook signature verification failed.",
        );
    }
}

export type WebhookOutcome =
    | "payment_succeeded"
    | "amount_mismatch_needs_review"
    | "late_payment_needs_review"
    | "payment_failed"
    | "payment_failed_order_expired"
    | "already_paid"
    | "order_needs_review";

export type ProcessResult = {
    received: true;
    duplicate: boolean;
    outcome: WebhookOutcome;
    orderStatus: string;
};

/**
 * Applies one payment event to one order, exactly once.
 *
 * Idempotency comes from the primary key on `webhook_events.event_id`. The
 * insert happens inside the same transaction as the order update, so either
 * both land or neither does; a replay loses the insert and is answered from
 * the outcome recorded the first time. A replay carrying the *same* event id
 * but different data is a provider bug, and is rejected rather than applied.
 */
export async function processPaymentEvent(
    body: PaymentWebhookBody,
): Promise<ProcessResult> {
    const paymentStatus = body.status === "captured" ? "succeeded" : "failed";

    return withTransaction(async (client) => {
        const orderResult = await client.query<{
            id: string;
            status: string;
            total_paise: number;
            is_expired: boolean;
        }>(
            `SELECT
                 id,
                 status,
                 total_paise,
                 expires_at <= clock_timestamp() AS is_expired
               FROM orders
              WHERE id = $1
                FOR UPDATE`,
            [body.orderId],
        );

        const order = orderResult.rows[0];

        if (!order) {
            throw notFound("ORDER_NOT_FOUND", "Order not found.");
        }

        const inserted = await client.query(
            `INSERT INTO webhook_events
                 (event_id, order_id, amount_paise, payment_status, outcome)
             VALUES ($1, $2, $3, $4, 'processing')
             ON CONFLICT (event_id) DO NOTHING
             RETURNING event_id`,
            [body.eventId, body.orderId, body.amountPaise, paymentStatus],
        );

        if (inserted.rowCount === 0) {
            return replayStoredOutcome(client, body, paymentStatus);
        }

        const outcome = await applyEvent(client, order, body, paymentStatus);

        await client.query(
            `UPDATE webhook_events SET outcome = $1 WHERE event_id = $2`,
            [outcome, body.eventId],
        );

        const finalStatus = await client.query<{ status: string }>(
            `SELECT status FROM orders WHERE id = $1`,
            [order.id],
        );

        return {
            received: true as const,
            duplicate: false,
            outcome,
            orderStatus: finalStatus.rows[0]!.status,
        };
    });
}

type DbClient = Parameters<Parameters<typeof withTransaction>[0]>[0];

type LockedOrder = {
    id: string;
    status: string;
    total_paise: number;
    is_expired: boolean;
};

async function replayStoredOutcome(
    client: DbClient,
    body: PaymentWebhookBody,
    paymentStatus: string,
): Promise<ProcessResult> {
    const previous = await client.query<{
        order_id: string;
        amount_paise: number;
        payment_status: string;
        outcome: WebhookOutcome;
    }>(
        `SELECT order_id, amount_paise, payment_status, outcome
           FROM webhook_events
          WHERE event_id = $1`,
        [body.eventId],
    );

    const stored = previous.rows[0];

    if (
        !stored ||
        stored.order_id !== body.orderId ||
        stored.amount_paise !== body.amountPaise ||
        stored.payment_status !== paymentStatus
    ) {
        throw conflict(
            "EVENT_ID_CONFLICT",
            "This event ID was already used with different payment data.",
        );
    }

    const current = await client.query<{ status: string }>(
        `SELECT status FROM orders WHERE id = $1`,
        [body.orderId],
    );

    return {
        received: true as const,
        duplicate: true,
        outcome: stored.outcome,
        orderStatus: current.rows[0]?.status ?? "unknown",
    };
}

async function markNeedsReview(
    client: DbClient,
    orderId: string,
): Promise<void> {
    // Only an order that has not been fulfilled can be diverted to review.
    // A paid or already collected order is left alone.
    await client.query(
        `UPDATE orders
            SET status = 'needs_review'
          WHERE id = $1 AND status IN ('pending', 'expired')`,
        [orderId],
    );
}

async function applyEvent(
    client: DbClient,
    order: LockedOrder,
    body: PaymentWebhookBody,
    paymentStatus: string,
): Promise<WebhookOutcome> {
    // The amount is checked before anything else: money that does not match
    // the order total is never treated as payment for that order.
    if (body.amountPaise !== order.total_paise) {
        await markNeedsReview(client, order.id);
        return "amount_mismatch_needs_review";
    }

    if (paymentStatus === "failed") {
        if (order.status === "pending" && order.is_expired) {
            await client.query(
                `UPDATE orders
                    SET status = 'expired'
                  WHERE id = $1 AND status = 'pending'`,
                [order.id],
            );
            return "payment_failed_order_expired";
        }

        // The order keeps its hold and will expire on its own, which leaves
        // the customer free to retry payment inside the window.
        return "payment_failed";
    }

    const holdIsGone =
        order.status === "expired" ||
        (order.status === "pending" && order.is_expired);

    if (holdIsGone) {
        // DECISION: a valid capture that lands after the hold expired is
        // never auto-fulfilled. The units may already belong to another
        // customer, and silently handing them over would oversell. The order
        // goes to needs_review for a human to refund or restock. See README.
        await markNeedsReview(client, order.id);
        return "late_payment_needs_review";
    }

    if (order.status === "paid" || order.status === "claimed") {
        // A second, distinct event for an order that is already paid (for
        // example the provider's own retry under a new event id). Nothing to
        // do, and nothing to undo.
        return "already_paid";
    }

    if (order.status !== "pending") {
        return "order_needs_review";
    }

    // The happy path. The units have been held since the order was created
    // and stay held until pickup, so stock is not touched here: it is
    // decremented once, permanently, when the locker claim succeeds.
    await client.query(
        `UPDATE orders
            SET status = 'paid',
                paid_at = clock_timestamp()
          WHERE id = $1 AND status = 'pending'`,
        [order.id],
    );

    return "payment_succeeded";
}
