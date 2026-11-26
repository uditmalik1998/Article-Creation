-- buying_type on the three SRM raw tables. Filled by the SRM writer (any casing);
-- the raw crons copy it (PLANNED / READY normalised) to extraction_results_flat /
-- fabric_article_data / gm_article_data.buying_type when the article is created.
-- Must be applied BEFORE the backend deploy (raw crons read buying_type).
ALTER TABLE raw_articles    ADD COLUMN IF NOT EXISTS buying_type VARCHAR(50);
ALTER TABLE fabric_raw_data ADD COLUMN IF NOT EXISTS buying_type VARCHAR(50);
ALTER TABLE gm_raw_data     ADD COLUMN IF NOT EXISTS buying_type VARCHAR(50);
