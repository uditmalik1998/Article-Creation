-- Migration: move combo/set article support from fabric_article_data (wrong
-- table — that's the separate "Fabric Article" page) to extraction_results_flat,
-- which is what actually backs "FG Articles > New articles"
-- (GET /approver/items?presentationsType=FG Article).
--
-- Lets one FG "parent" article (e.g. Kurti Set, Baba Suit) be assembled from
-- multiple "child" pieces (e.g. Kurti Upper, Lower, Dupatta). Children are
-- approved/synced to SAP first as their own articles; the parent
-- (comboRole = PARENT) is held by runApprovalSyncTick until every child is
-- SYNCED. Only the parent gets colour x size variants.

-- Undo the earlier (incorrect) migration on fabric_article_data, if present.
ALTER TABLE public.fabric_article_data DROP CONSTRAINT IF EXISTS fk_fabric_article_data_combo_parent;
DROP INDEX IF EXISTS public.idx_fabric_article_data_combo_parent_id;
DROP INDEX IF EXISTS public.idx_fabric_article_data_combo_role;
ALTER TABLE public.fabric_article_data
  DROP COLUMN IF EXISTS combo_role,
  DROP COLUMN IF EXISTS combo_parent_id,
  DROP COLUMN IF EXISTS combo_child_order;

-- combo_role enum type already exists from the earlier migration; reused here.
DO $$ BEGIN
  CREATE TYPE public.combo_role AS ENUM ('NONE', 'PARENT', 'CHILD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- extraction_results_flat.id is TEXT (not UUID), so combo_parent_id must match.
ALTER TABLE public.extraction_results_flat
  ADD COLUMN IF NOT EXISTS combo_role         public.combo_role NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS combo_parent_id    TEXT,
  ADD COLUMN IF NOT EXISTS combo_child_order  INTEGER;

-- NOT VALID: every existing combo_parent_id is NULL, so there is nothing to
-- check; skipping the validation scan avoids holding a write-blocking lock on
-- this large, busy table. New rows are still checked.
DO $$ BEGIN
  ALTER TABLE public.extraction_results_flat
    ADD CONSTRAINT fk_extraction_results_flat_combo_parent
      FOREIGN KEY (combo_parent_id) REFERENCES public.extraction_results_flat(id) ON DELETE CASCADE
      NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_extraction_results_flat_combo_parent_id ON public.extraction_results_flat (combo_parent_id);
CREATE INDEX IF NOT EXISTS idx_extraction_results_flat_combo_role      ON public.extraction_results_flat (combo_role);
