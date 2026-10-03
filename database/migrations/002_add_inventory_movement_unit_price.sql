USE portal_gmac;

ALTER TABLE inventory_movements
  ADD COLUMN unit_price_kg DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER quantity_kg;
