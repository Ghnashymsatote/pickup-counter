import "dotenv/config";
import { z } from "zod";

/**
 * Environment is validated once, at boot. A missing DATABASE_URL or a weak
 * WEBHOOK_SECRET is a configuration bug, and the process should refuse to
 * start rather than fail later on the first request.
 */
const envSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    PORT: z.coerce.number().int().positive().default(5001),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    WEBHOOK_SECRET: z
        .string()
        .min(16, "WEBHOOK_SECRET must be at least 16 characters"),
    HOLD_SECONDS: z.coerce.number().int().positive().default(120),
    CORS_ORIGIN: z.string().default("*"),
    // The customer screen's "Pay with UPI" button calls
    // POST /payments/simulate/:orderId. That endpoint can mark an order paid
    // without a real provider, so it is opt-in and must stay off anywhere
    // real money is involved.
    ENABLE_PAYMENT_SIMULATION: z
        .enum(["true", "false"])
        .default("true")
        .transform((value) => value === "true"),
    RUN_MIGRATIONS_ON_BOOT: z
        .enum(["true", "false"])
        .default("true")
        .transform((value) => value === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const issues = parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");

    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
}

export const env = parsed.data;
