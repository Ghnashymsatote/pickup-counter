
import "dotenv/config";
import express from "express";
import cors from "cors";
import productRoutes from "./routes/product.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import orderRoutes from "./routes/order.routes.js";
import { pool } from "./config/db.js";
const app = express();

app.use(cors());

app.use(
    express.json({
        verify: (req, _res, buffer) => {
            (req as express.Request & { rawBody?: Buffer }).rawBody =
                Buffer.from(buffer);
        },
    }),
);
app.get("/health", async (_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", database: "connected" });
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

export default app;
