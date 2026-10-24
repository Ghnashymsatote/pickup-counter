import { pool } from "../config/db.js";
import { HELD_UNITS_SUBQUERY_SQL } from "../db/holds.js";

export type ProductView = {
    id: string;
    name: string;
    pricePaise: number;
    stock: number;
    availableStock: number;
};

export async function listProducts(): Promise<ProductView[]> {
    const result = await pool.query<ProductView>(
        `SELECT
             p.id,
             p.name,
             p.price_paise AS "pricePaise",
             p.stock,
             GREATEST(p.stock - ${HELD_UNITS_SUBQUERY_SQL}, 0) AS "availableStock"
         FROM products p
         WHERE p.active = TRUE
         ORDER BY p.name`,
    );

    return result.rows;
}
