-- extraction_results_flat: rename fab_vdr -> m_fab_vdr (2026-11-11). NOT applied yet.
-- Prisma field stays fabVdr (@map now "m_fab_vdr"); no code change. No views / functions / indexes use the column.
-- Run this AT THE SAME TIME as deploying the new backend: the old backend reads fab_vdr, the new one m_fab_vdr.
ALTER TABLE public.extraction_results_flat RENAME COLUMN fab_vdr TO m_fab_vdr;
