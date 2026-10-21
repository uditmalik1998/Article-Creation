-- Set article → SAP link (setLinkService): a set part's old article (MARA-BISMT)
-- is set to its parent's article number by Z_ART_PATCH_RFC_V69 after creation.
-- Additive and nullable: existing rows are untouched (status NULL = not tried yet).
ALTER TABLE public.extraction_results_flat
    ADD COLUMN IF NOT EXISTS set_link_status   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS set_link_message  TEXT,
    ADD COLUMN IF NOT EXISTS set_link_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS set_linked_at     TIMESTAMPTZ(6);
