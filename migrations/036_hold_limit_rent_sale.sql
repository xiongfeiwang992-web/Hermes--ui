PRAGMA foreign_keys = ON;

ALTER TABLE settings ADD COLUMN house_hold_limit_sale INTEGER;
ALTER TABLE settings ADD COLUMN house_hold_limit_rent INTEGER;

UPDATE settings
SET house_hold_limit_sale = COALESCE(house_hold_limit_sale, house_hold_limit, 20),
    house_hold_limit_rent = COALESCE(house_hold_limit_rent, house_hold_limit, 20);
