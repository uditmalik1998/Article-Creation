-- FG M_BUYING_TYPE (OTH GRID-1 card, below M_IMP_ATBT): PLANNED / READY.
-- Must be applied BEFORE the backend deploy (FG list/detail selects buying_type).
ALTER TABLE extraction_results_flat ADD COLUMN IF NOT EXISTS buying_type VARCHAR(50);
