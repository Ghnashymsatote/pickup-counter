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
