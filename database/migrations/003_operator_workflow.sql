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
