CREATE DATABASE IF NOT EXISTS portal_gmac;
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
  birth_date DATE NOT NULL,
  cpf VARCHAR(11) NOT NULL UNIQUE,
  email VARCHAR(160) NOT NULL UNIQUE,
  i_identificacao CHAR(3) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS clients (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  document_type ENUM('cpf', 'cnpj') NOT NULL,
  document VARCHAR(14) NOT NULL UNIQUE,
  email VARCHAR(160) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  CONSTRAINT fk_order_operation_events_operation FOREIGN KEY (order_code)
    REFERENCES order_operations (order_code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_materials (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  detail VARCHAR(255) NULL,
  quantity_kg DECIMAL(12,3) NOT NULL DEFAULT 0,
  minimum_kg DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
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
  CONSTRAINT fk_inventory_movements_material
    FOREIGN KEY (material_id) REFERENCES inventory_materials (id)
    ON DELETE CASCADE
);
