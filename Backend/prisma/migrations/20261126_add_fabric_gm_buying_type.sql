-- M_BUYING_TYPE (PLANNED / READY) on the Fabric + GM BOM cards.
-- Must be applied BEFORE the backend deploy (Fabric/GM selects read buying_type).
ALTER TABLE fabric_article_data ADD COLUMN IF NOT EXISTS buying_type VARCHAR(50);
ALTER TABLE gm_article_data ADD COLUMN IF NOT EXISTS buying_type VARCHAR(50);
