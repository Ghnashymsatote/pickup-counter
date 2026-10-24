import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { pool } from "./config/db.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import orderRoutes from "./routes/order.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import productRoutes from "./routes/product.routes.js";

const app = express();

// Behind the nginx container, so trust the proxy for client IPs.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
    cors({
        origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
    }),
);

app.use(
    express.json({
        limit: "64kb",
        // Keep the raw bytes for webhook signature verification.
        verify: (req, _res, buffer) => {
            (req as express.Request).rawBody = Buffer.from(buffer);
        },
    }),
);

// One line per request, with the status and duration. Enough to follow what
// the lockers and the provider actually did, without pulling in a logger.
app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(
            `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`,
        );
    });

    next();
});

app.get("/health", async (_req, res) => {
    try {
        const result = await pool.query<{ now: Date }>(
            "SELECT clock_timestamp() AS now",
        );

        res.json({
            status: "ok",
            database: "connected",
            // Exposed so a client can see how far its own clock has drifted.
            serverTime: result.rows[0]!.now,
        });
    } catch {
        res.status(503).json({
            status: "error",
            database: "disconnected",
        });
    }
});

app.use("/products", productRoutes);
app.use("/orders", orderRoutes);
app.use("/payments", paymentRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
