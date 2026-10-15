-- Master table for basic trim costing by attribute name + type value.
-- Source: BASIC TRIMS 2 TYPE COSTING.xlsx — Sheet1
-- Columns: attribute_name, type, bt_1 (BT-1 cost), bt_2 (BT2 cost)
-- Unique on (attribute_name, type). Safe to re-run (idempotent).

CREATE TABLE IF NOT EXISTS basic_trim_master (
  id             SERIAL PRIMARY KEY,
  attribute_name VARCHAR(100) NOT NULL,
  type           VARCHAR(100) NOT NULL,
  bt_1           DECIMAL(10, 4),
  bt_2           DECIMAL(10, 4),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS basic_trim_master_uniq
  ON basic_trim_master (attribute_name, type);

CREATE INDEX IF NOT EXISTS basic_trim_master_attr_idx
  ON basic_trim_master (attribute_name);
