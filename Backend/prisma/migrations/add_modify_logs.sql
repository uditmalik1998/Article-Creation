-- Migration: add modify_logs table for article modification audit logging
-- Created: 2026-07-15

CREATE TABLE IF NOT EXISTS public.modify_logs (
  id                    SERIAL PRIMARY KEY,
  modification_group_id UUID         NOT NULL,
  article_number        VARCHAR(30)  NOT NULL,
  label_name            VARCHAR(100) NOT NULL,
  old_value             TEXT,
  new_value             TEXT,
  modified_by_name      VARCHAR(200) NOT NULL DEFAULT '',
  modified_by_email     VARCHAR(255) NOT NULL DEFAULT '',
  modified_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  sap_status            VARCHAR(20)  NOT NULL DEFAULT 'SUCCESS'
);

CREATE INDEX IF NOT EXISTS idx_modify_logs_article_modified
  ON public.modify_logs (article_number, modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_modify_logs_modification_group_id
  ON public.modify_logs (modification_group_id);

CREATE INDEX IF NOT EXISTS idx_modify_logs_label_name
  ON public.modify_logs (label_name);

CREATE INDEX IF NOT EXISTS idx_modify_logs_modified_by_email
  ON public.modify_logs (modified_by_email);

CREATE INDEX IF NOT EXISTS idx_modify_logs_modified_at
  ON public.modify_logs (modified_at DESC);
