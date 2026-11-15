-- Estoque Administrativo (2026-11-14): office, cleaning and pantry supplies (papel higiênico, lápis, caneta...).
-- Its own tables, apart from the factory stock: these items never show up in offers or OS, and they leave the stock by
-- a "baixa" typed on the screen (who took it is recorded), not by an OS.
-- The portal also creates these tables by itself when it starts (server/adminInventory.js); running this file is safe.

CREATE TABLE IF NOT EXISTS admin_inventory_materials (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  unit VARCHAR(4) NOT NULL DEFAULT 'un',
  quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
  minimum DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  icon VARCHAR(24) NOT NULL DEFAULT 'office',
  photo TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_admin_inventory_materials_name (name)
);

CREATE TABLE IF NOT EXISTS admin_inventory_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id INT UNSIGNED NOT NULL,
  movement_type ENUM('creation', 'entry', 'exit') NOT NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_after DECIMAL(12,3) NOT NULL,
  destination VARCHAR(255) NULL,
  notes VARCHAR(500) NULL,
  user_name VARCHAR(160) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_admin_inventory_movements_material_date (material_id, created_at),
  CONSTRAINT fk_admin_inventory_movements_material
    FOREIGN KEY (material_id) REFERENCES admin_inventory_materials (id)
    ON DELETE CASCADE
);
