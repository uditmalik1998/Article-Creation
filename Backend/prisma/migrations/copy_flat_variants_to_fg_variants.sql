-- One-time copy: FG variants from extraction_results_flat (is_generic = false)
-- into fg_variants_article_data. The app now reads variants only from
-- fg_variants_article_data. Rows keep their original id.
--
-- Not copied: variants with no parent, no size or no colour, and every row of a
-- parent/size/colour combination that appears more than once. Rows already in
-- fg_variants_article_data (same id, or same parent/size/colour) are skipped,
-- so the script is safe to re-run. Weight and fabric article number are not carried.

BEGIN;

WITH dup AS (
    SELECT generic_article_id, UPPER(TRIM(variant_size)) AS s, UPPER(TRIM(variant_color)) AS c
    FROM public.extraction_results_flat
    WHERE is_generic = false
    GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
)
INSERT INTO public.fg_variants_article_data (
    id, generic_article_id, generic_article_number,
    variant_color, variant_size, variant_article_number,
    division, sub_division, major_category, vendor_name, vendor_code, design_number,
    mrp, rate,
    approval_status, approved_at, approved_by, sap_sync_status, sap_sync_message,
    image_url, created_at, updated_at
)
SELECT
    v.id,
    v.generic_article_id,
    COALESCE(g.sap_article_id, g.article_number),
    v.variant_color,
    v.variant_size,
    -- SAP number only; article_number is used only when SAP marked it SYNCED
    COALESCE(NULLIF(TRIM(v.sap_article_id), ''),
             CASE WHEN v.sap_sync_status::text = 'SYNCED' THEN NULLIF(TRIM(v.article_number), '') END),
    v.division, v.sub_division, v.major_category, v.vendor_name, v.vendor_code, v.design_number,
    v.mrp, v.rate,
    v.approval_status::text, v.approved_at, v.approved_by, v.sap_sync_status::text, v.sap_sync_message,
    v.image_url,
    COALESCE(v.created_at, now()),
    COALESCE(v.updated_at, v.created_at, now())
FROM public.extraction_results_flat v
JOIN public.extraction_results_flat g ON g.id = v.generic_article_id
WHERE v.is_generic = false
  AND v.variant_size IS NOT NULL
  AND v.variant_color IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM dup d
      WHERE d.generic_article_id = v.generic_article_id
        AND d.s = UPPER(TRIM(v.variant_size))
        AND d.c = UPPER(TRIM(v.variant_color))
  )
  AND NOT EXISTS (
      SELECT 1 FROM public.fg_variants_article_data f
      WHERE f.id = v.id
         OR (f.generic_article_id = v.generic_article_id
             AND UPPER(TRIM(f.variant_size)) = UPPER(TRIM(v.variant_size))
             AND UPPER(TRIM(f.variant_color)) = UPPER(TRIM(v.variant_color)))
  );

COMMIT;
