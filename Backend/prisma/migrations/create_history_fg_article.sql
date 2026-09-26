-- Migration: create history_fg_article table
-- Stores per-field change history for FG articles (extraction_results_flat).
-- Populated by ApproverController.updateItem on every successful PUT.
-- Excluded: fabricArticleDescription, bodyArticleDescription (per product requirement).

CREATE TABLE IF NOT EXISTS public.history_fg_article (
  id              SERIAL PRIMARY KEY,
  article_id      TEXT NOT NULL,
  changed_by_id   INTEGER,
  changed_by_name VARCHAR(200),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  field_name      VARCHAR(100) NOT NULL,
  old_value       TEXT,
  new_value       TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_fg_article_id   ON public.history_fg_article (article_id);
CREATE INDEX IF NOT EXISTS idx_history_fg_article_time ON public.history_fg_article (changed_at DESC);
