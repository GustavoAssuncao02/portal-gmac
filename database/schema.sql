CREATE DATABASE IF NOT EXISTS portal_gmac CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE portal_gmac;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  birth_date DATE NOT NULL,
  cpf VARCHAR(11) NOT NULL UNIQUE,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  i_identificacao CHAR(3) NULL UNIQUE,
  role ENUM('admin', 'employee') NOT NULL DEFAULT 'employee',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS employees (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  birth_date DATE NULL,
  cpf VARCHAR(11) NOT NULL UNIQUE,
  email VARCHAR(160) NULL UNIQUE,
  i_identificacao CHAR(3) NULL UNIQUE,
  employee_type ENUM('operator', 'administrative') NOT NULL DEFAULT 'operator',
  access_code CHAR(4) NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  sector_id VARCHAR(64) NULL,
  sector_ids TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS clients (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  document_type ENUM('cpf', 'cnpj') NOT NULL,
  document VARCHAR(14) NOT NULL UNIQUE,
  email VARCHAR(160) NULL UNIQUE,
  notes VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Logins of the administrators (12 h), kept across restarts of the API. Only a hash of each token is stored.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_key VARCHAR(64) NOT NULL,
  user_id VARCHAR(80) NOT NULL,
  user_name VARCHAR(200) NULL,
  role VARCHAR(20) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY admin_sessions_user (user_key),
  KEY admin_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_operations (
  order_code VARCHAR(80) NOT NULL,
  data JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (order_code)
);

CREATE TABLE IF NOT EXISTS order_operation_events (
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id CHAR(36) NOT NULL UNIQUE,
  order_code VARCHAR(80) NOT NULL,
  data JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  PRIMARY KEY (seq),
  INDEX idx_order_operation_events_order (order_code, occurred_at),
  INDEX idx_order_operation_events_order_seq (order_code, seq),
  INDEX idx_order_operation_events_date_seq (occurred_at, seq),
  CONSTRAINT fk_order_operation_events_operation FOREIGN KEY (order_code)
    REFERENCES order_operations (order_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_materials (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  detail VARCHAR(255) NULL,
  unit VARCHAR(4) NOT NULL DEFAULT 'kg',
  quantity_kg DECIMAL(12,3) NOT NULL DEFAULT 0,
  minimum_kg DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  icon VARCHAR(24) NOT NULL DEFAULT 'sheet',
  photo TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_inventory_materials_name (name)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_id INT UNSIGNED NOT NULL,
  movement_type ENUM('creation', 'entry', 'exit') NOT NULL,
  quantity_kg DECIMAL(12,3) NOT NULL,
  unit_price_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_after_kg DECIMAL(12,3) NOT NULL,
  destination VARCHAR(255) NULL,
  order_code VARCHAR(80) NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_inventory_movements_material_date (material_id, created_at),
  INDEX idx_inventory_movements_order_type (order_code, movement_type),
  CONSTRAINT fk_inventory_movements_material
    FOREIGN KEY (material_id) REFERENCES inventory_materials (id)
    ON DELETE CASCADE
);
