-- Five seed products. ON CONFLICT keeps re-running this file harmless and
-- means a restart never resets stock that the counter has already sold.
INSERT INTO products (name, price_paise, stock)
VALUES
    ('Potato Chips', 2000, 10),
    ('Chocolate Bar', 3000, 8),
    ('Cookies', 2500, 12),
    ('Fruit Juice', 4000, 6),
    ('Sandwich', 6000, 5)
ON CONFLICT (name) DO NOTHING;

-- Image locations, applied separately so re-running only refreshes the paths
-- and never resets stock.
UPDATE products
SET image_url = CASE name
    WHEN 'Potato Chips' THEN '/images/potato-chips.jpg'
    WHEN 'Chocolate Bar' THEN '/images/chocolate-bar.jpg'
    WHEN 'Cookies' THEN '/images/cookies.jpg'
    WHEN 'Fruit Juice' THEN '/images/fruit-juice.jpg'
    WHEN 'Sandwich' THEN '/images/sandwich.jpg'
    ELSE image_url
END
WHERE name IN (
    'Potato Chips',
    'Chocolate Bar',
    'Cookies',
    'Fruit Juice',
    'Sandwich'
);
