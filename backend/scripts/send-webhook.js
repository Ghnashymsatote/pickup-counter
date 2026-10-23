"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_crypto_1 = require("node:crypto");
const orderId = process.argv[2];
if (!orderId) {
    console.error("Usage: npm run send-webhook -- <order-id>");
    process.exit(1);
}
const secret = process.env.WEBHOOK_SECRET;
const baseUrl = process.env.API_BASE_URL ?? "http://localhost:5001";
if (!secret) {
    console.error("Missing WEBHOOK_SECRET in backend/.env");
    process.exit(1);
}
const payload = {
    eventId: `evt_test_${Date.now()}`,
    orderId,
    amountPaise: Number(process.env.TEST_AMOUNT_PAISE ?? 2500),
    status: "captured",
};
const rawBody = JSON.stringify(payload);
const signature = (0, node_crypto_1.createHmac)("sha256", secret)
    .update(rawBody)
    .digest("hex");
async function main() {
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
}
main().catch((error) => {
    console.error("Webhook request failed:", error);
    process.exitCode = 1;
});
