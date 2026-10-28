-- One-time copy: FG Created-page modifications (modify_logs) into history_fg_article,
-- the table the article History button reads. modify_logs itself is left as is.
WITH sap_map(sap_key, field) AS (VALUES
('HSN_CODE','hsnTaxCode'),
('SUB_DIV','subDivision'),
('MC_CD','mcCode'),
('VENDOR','vendorCode'),
('DSG_NO','designNumber'),
('MRP','mrp'),
('PURCH_PRICE','rate'),
('SEASON','season'),
('ARTICLE_DES1','articleDescription'),
('PRICE_BAND_CATEGORY','segment'),
('M_IMP_ATBT','impAtrbt2'),
('M_WEAVE_01','weave'),
('M_WEAVE_02','mFab2'),
('M_YARN','yarn1'),
('M_FAB_MAIN_MVGR_1','mainMvgr'),
('M_FAB_MAIN_MVGR_2','fabricMainMvgr'),
('M_COMPOSITION','composition'),
('M_FINISH','finish'),
('M_CONSTRUCTION','fConstruction'),
('M_SHADE','shade'),
('M_LYCRA','lycra'),
('M_GSM','gsm'),
('M_COUNT','fCount'),
('M_OUNZ','fOunce'),
('M_WIDTH','fWidth'),
('M_FAB_DIV','fabDiv'),
('M_FAB_VDR','fabVdr'),
('M_COLLAR_TYPE','collar'),
('M_COLLAR_STYLE','collarStyle'),
('M_NECK_TYPE','neck'),
('M_NECK_STYLE','neckDetails'),
('M_PLACKET','placket'),
('M_BLT_TYPE','fatherBelt'),
('M_BLT_STYLE','childBelt'),
('M_SLEEVES_MAIN_STYLE','sleeve'),
('M_SLEEVE_FOLD','sleeveFold'),
('M_SET','mSet'),
('M_BTM_FOLD','bottomFold'),
('M_NO_OF_POCKET','noOfPocket'),
('M_POCKET','pocketType'),
('M_EXTRA_POCKET','extraPocket'),
('M_FIT','fit'),
('M_BODY_STYLE','pattern'),
('M_LENGTH','length'),
('M_DC_STYLE','drawcord'),
('M_DC_SHAPE','dcShape'),
('M_BTN_TYPE','button'),
('M_BTN_CLR','btnColour'),
('M_ZIP_TYPE','zipper'),
('M_ZIP_COL','zipColour'),
('M_PATCHE_TYPE','patches'),
('M_PATCH_STYLE','patchesType'),
('M_HTRF_TYPE','htrfType'),
('M_HTRF_STYLE','htrfStyle'),
('M_PRINT_TYPE','printType'),
('M_PRINT_PLACEMENT','printPlacement'),
('M_PRINT_STYLE','printStyle'),
('M_EMB_TYPE','embroidery'),
('M_EMBROIDERY_STYLE','embroideryType'),
('M_EMB_PLACEMENT','embPlacement'),
('M_WASH','wash'),
('M_AGE_GROUP','ageGroup'),
('M_NO_OF_SIZE','mNoOfSize'),
('M_NO_OF_CLR','mNoOfClr'),
('M_FAB_WEIGHT','weight')
)
INSERT INTO history_fg_article (article_id, changed_by_id, changed_by_name, changed_at, field_name, old_value, new_value)
SELECT f.id, u.id, ml.modified_by_name, ml.modified_at,
       COALESCE(m.field, ml.label_name), ml.old_value, ml.new_value
FROM modify_logs ml
JOIN extraction_results_flat f ON f.sap_article_id = ml.article_number
LEFT JOIN sap_map m ON m.sap_key = ml.label_name
LEFT JOIN users u ON lower(u.email) = lower(ml.modified_by_email)
WHERE COALESCE(m.field, ml.label_name) NOT IN (
        'fabricArticleDescription', 'bodyArticleDescription', 'articleDescription', 'mcCode',
        'hsnTaxCode', 'mcDescription', 'attrArticleNums', 'vaddPrintJson', 'vaddEmpJson')
  AND NOT EXISTS (
        SELECT 1 FROM history_fg_article h
        WHERE h.article_id = f.id AND h.field_name = COALESCE(m.field, ml.label_name)
          AND h.changed_at = ml.modified_at);
