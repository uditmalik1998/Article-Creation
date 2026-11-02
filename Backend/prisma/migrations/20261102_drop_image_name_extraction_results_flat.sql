-- extraction_results_flat.image_name removal (2026-11-02). NOT applied yet.
-- Code no longer reads or writes image_name (Prisma field removed).

-- ── Step 1: safe any time (~22 MB freed) ──────────────────────────────────
DROP INDEX IF EXISTS public.extraction_results_flat_image_name_idx;
DROP INDEX IF EXISTS public.idx_erf_image_name_trgm;

-- is_old_article no longer looks at image_name (it only ever held a storage UUID; 0 rows depended on it).
CREATE OR REPLACE FUNCTION public.set_is_old_article()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.is_old_article := COALESCE(
    (
      NEW.image_unc_path ILIKE '%PIC-LADIES-LESS THAN 180%'
      OR NEW.image_unc_path ILIKE '%PIC-KIDS-LESS THAN 180%'
      OR NEW.image_unc_path ILIKE '%PIC-MENS-LESS THAN 180%'
    ) OR (
      NEW.approval_status = 'PENDING'
      AND char_length(NEW.article_number) = 10 AND NEW.article_number ~ '^[0-9]{10}$'
    ),
    false
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_is_old_article ON public.extraction_results_flat;
CREATE TRIGGER trg_set_is_old_article
  BEFORE INSERT OR UPDATE OF image_unc_path, article_number, approval_status
  ON public.extraction_results_flat
  FOR EACH ROW EXECUTE FUNCTION set_is_old_article();

-- ── Step 2: ONLY after the new backend is deployed ────────────────────────
-- (the old Prisma client selects image_name and would fail without it)
-- ALTER TABLE public.extraction_results_flat DROP COLUMN IF EXISTS image_name;
