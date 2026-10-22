
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    price_paise INTEGER NOT NULL CHECK (price_paise > 0),
    stock INTEGER NOT NULL CHECK (stock >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
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

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL
        REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0),
    UNIQUE (order_id, product_id)
);

CREATE TABLE webhook_events (
    event_id TEXT PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    payment_status TEXT NOT NULL,
    outcome TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_pending_expiry
    ON orders (expires_at)
    WHERE status = 'pending';

CREATE INDEX idx_order_items_product
    ON order_items (product_id);
