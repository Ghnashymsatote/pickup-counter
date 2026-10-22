
import "dotenv/config";
import express from "express";
import cors from "cors";
import pg from "pg";

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.use(cors());
app.use(express.json());

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);
    res.status(503).json({
      status: "error",
      database: "disconnected",
    });
  }
});

app.get("/products", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.price_paise AS "pricePaise",
        p.stock,
        GREATEST(
          p.stock - COALESCE(
            SUM(oi.quantity) FILTER (
              WHERE o.status = 'pending'
                AND o.expires_at > NOW()
            ),
            0
          ),
          0
        )::int AS "availableStock"
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.id
      LEFT JOIN orders o ON o.id = oi.order_id
      WHERE p.active = TRUE
      GROUP BY p.id
      ORDER BY p.name;
    `);

    res.json({ products: result.rows });
  } catch (error) {
    console.error("Failed to fetch products:", error);
    res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
      message: "Could not fetch products",
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on port ${port}`);
});
