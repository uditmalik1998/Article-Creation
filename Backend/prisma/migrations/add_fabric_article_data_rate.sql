-- Adds the Fabric Rate field to fabric_article_data, placed logically right
-- after Vendor Code in the bulk-insert template/upload and the admin table
-- view (physical column order in Postgres is append-only; the visible
-- ordering is controlled in the template/registry/config instead).
ALTER TABLE fabric_article_data ADD COLUMN IF NOT EXISTS fabric_rate DECIMAL(10, 2);
