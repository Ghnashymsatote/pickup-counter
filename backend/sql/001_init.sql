-- Schema for the pickup counter.
--
-- Every statement is idempotent so the migration runner can safely apply this
-- file against a database that is already up to date.
--
-- Money is always stored as whole paise in INTEGER columns. There is no
-- floating-point money anywhere in this system.

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    price_paise INTEGER NOT NULL CHECK (price_paise > 0),
    -- The CHECK is the last line of defence: stock can never go negative,
    -- whatever the application does.
    stock INTEGER NOT NULL CHECK (stock >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Path served by the frontend (e.g. /images/cookies.jpg), or NULL for
    -- products that fall back to the initial-letter placeholder.
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For databases created before image_url existed. CREATE TABLE IF NOT EXISTS
-- above is a no-op for them, so the column has to be added separately.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'paid',
            'expired',
            'needs_review',
            'claimed'
        )),
    total_paise INTEGER NOT NULL CHECK (total_paise > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL
        REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0),
    UNIQUE (order_id, product_id)
);

-- One row per payment event ever seen. The primary key on event_id is what
-- makes webhook delivery idempotent: a replayed event loses the INSERT race
-- (or the ON CONFLICT) and is answered from the stored outcome.
CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    payment_status TEXT NOT NULL,
    outcome TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_pending_expiry
    ON orders (expires_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_order_items_product
    ON order_items (product_id);

-- Supports the availability subquery, which filters order_items by the
-- status of their parent order.
CREATE INDEX IF NOT EXISTS idx_orders_status
    ON orders (status);
