import "dotenv/config";
import { createHmac } from "node:crypto";

/**
 * Sends a correctly signed payment webhook, the way the provider would.
 *
 *   npm run send-webhook -- <order-id>                  pay the exact total
 *   npm run send-webhook -- <order-id> --amount 1       wrong amount
 *   npm run send-webhook -- <order-id> --status failed  failed capture
 *   npm run send-webhook -- <order-id> --event evt_123  reuse an event id
 *
 * Re-running with the same --event is the easiest way to see that replaying
 * an event changes nothing.
 */

type Options = {
    orderId: string;
    amountPaise?: number;
    status: "captured" | "failed";
    eventId: string;
};

function parseArgs(argv: string[]): Options {
    const [orderId, ...rest] = argv;

    if (!orderId) {
        console.error(
            "Usage: npm run send-webhook -- <order-id> " +
                "[--amount <paise>] [--status captured|failed] [--event <id>]",
        );
        process.exit(1);
    }

    const options: Options = {
        orderId,
        status: "captured",
        eventId: `evt_${Date.now()}`,
    };

    for (let i = 0; i < rest.length; i += 2) {
        const flag = rest[i];
        const value = rest[i + 1];

        if (!value) {
            console.error(`Missing value for ${flag}`);
            process.exit(1);
        }

        if (flag === "--amount") options.amountPaise = Number(value);
        else if (flag === "--status")
            options.status = value as Options["status"];
        else if (flag === "--event") options.eventId = value;
        else {
            console.error(`Unknown option ${flag}`);
            process.exit(1);
        }
    }

    return options;
}

const options = parseArgs(process.argv.slice(2));

const secret = process.env.WEBHOOK_SECRET;
const baseUrl = process.env.API_BASE_URL ?? "http://localhost:5001";

if (!secret) {
    console.error("Missing WEBHOOK_SECRET. Copy backend/.env.example to .env.");
    process.exit(1);
}

/**
 * Unless an amount is given, read the order's real total so the webhook
 * matches it. Guessing an amount would land every order in needs_review.
 */
async function resolveAmountPaise(): Promise<number> {
    if (options.amountPaise !== undefined) return options.amountPaise;

    const response = await fetch(`${baseUrl}/orders/${options.orderId}`);

    if (!response.ok) {
        console.error(
            `Could not read order ${options.orderId} ` +
                `(HTTP ${response.status}). Pass --amount to send anyway.`,
        );
        process.exit(1);
    }

    const body = (await response.json()) as {
        order: { totalPaise: number };
    };

    return body.order.totalPaise;
}

async function main(): Promise<void> {
    const payload = {
        eventId: options.eventId,
        orderId: options.orderId,
        amountPaise: await resolveAmountPaise(),
        status: options.status,
    };

    // Sign the exact bytes that get sent; the server verifies the raw body.
    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha256", secret!).update(rawBody).digest("hex");

    console.log("Sending:", payload);

    const response = await fetch(`${baseUrl}/payments/webhook`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Signature": signature,
        },
        body: rawBody,
    });

    console.log("HTTP status:", response.status);
    console.log("Response:", await response.text());

    if (!response.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
    console.error("Webhook request failed:", error);
    process.exitCode = 1;
});
