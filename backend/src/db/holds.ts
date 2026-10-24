/**
 * A unit is "held" and therefore not sellable to anyone else when it belongs
 * to either:
 *
 *   - a pending order whose 120-second hold has not run out, or
 *   - a paid order that has not been collected from the locker yet.
 *
 * The brief defines available units as "stock minus units currently held by
 * unpaid orders". Paid-but-unclaimed units are included here as well, because
 * stock is only decremented at pickup-claim: without that second term a paid
 * order's units would briefly look sellable again and could be oversold.
 *
 * `$1` is a uuid[] of product ids.
 */
export const HELD_UNITS_BY_PRODUCT_SQL = `
    SELECT
        oi.product_id,
        COALESCE(SUM(oi.quantity), 0)::int AS held
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.product_id = ANY($1::uuid[])
      AND (
            (o.status = 'pending' AND o.expires_at > clock_timestamp())
         OR o.status = 'paid'
      )
    GROUP BY oi.product_id`;

/** The same rule as a scalar subquery, correlated against `p.id`. */
export const HELD_UNITS_SUBQUERY_SQL = `
    COALESCE((
        SELECT SUM(oi.quantity)
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id
          AND (
                (o.status = 'pending' AND o.expires_at > clock_timestamp())
             OR o.status = 'paid'
          )
    ), 0)::int`;
