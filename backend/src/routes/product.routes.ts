
import { Router } from "express";
import { pool } from "../config/db.js";

const router = Router();

router.get("/", async (_req, res) => {
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

export default router;
