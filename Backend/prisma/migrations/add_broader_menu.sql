-- BROADER MENU merchandising master (BM-H sheet of the Broader Menu workbook).
-- One row per MC CD: the SEG -> DIV -> SUB_DIV -> MAJ_CAT -> SUB_CAT -> MC
-- hierarchy plus status flags, pack sizes, fixture densities and the
-- rename/remarks trail. Fed by the Expense page's bulk uploader.
--
-- Safe to re-run: every statement is guarded.

CREATE TABLE IF NOT EXISTS "broader_menu" (
  "id"                SERIAL NOT NULL,
  "sn"                INTEGER,
  "mc_cd"             INTEGER NOT NULL,
  "seg"               VARCHAR(50),
  "div"               VARCHAR(50),
  "sub_div"           VARCHAR(50),
  "maj_cat_cd"        INTEGER,
  "maj_cat_nm"        VARCHAR(200),
  "sub_cat_cd"        INTEGER,
  "sub_cat_desc"      VARCHAR(200),
  "mc_desc"           VARCHAR(300),
  "ssn"               VARCHAR(20),
  "mc_stat"           VARCHAR(20),
  "sub_cat_stat"      VARCHAR(20),
  "maj_cat_stat"      VARCHAR(20),
  "size_applicable"   VARCHAR(10),
  "div_stat"          VARCHAR(20),
  "mc_pk_sz"          INTEGER,
  "sub_cat_pk_sz"     INTEGER,
  "no_of_options"     INTEGER,
  "avg_density"       DECIMAL(14,4),
  "acc_density"       DECIMAL(14,4),
  "wg_density"        DECIMAL(14,4),
  "fg_46ft_density"   DECIMAL(14,4),
  "fg_5ft_density"    DECIMAL(14,4),
  "fg_4a_density"     DECIMAL(14,4),
  "fg_8a_density"     DECIMAL(14,4),
  "acp"               DECIMAL(14,4),
  "old_density"       DECIMAL(14,4),
  "seq"               INTEGER,
  "mj_cat_typ"        VARCHAR(20),
  "fixtr"             VARCHAR(100),
  "new_mc_cd"         INTEGER,
  "new_mc_desc"       VARCHAR(300),
  "old_mc_desc"       VARCHAR(300),
  "old_sub_cat_cd"    INTEGER,
  "old_sub_cat_desc"  VARCHAR(200),
  "legacy_mc_desc"    VARCHAR(300),
  "effective_date"    DATE,
  "remarks"           VARCHAR(300),
  "gm_status"         VARCHAR(50),
  "current_mc_status" VARCHAR(50),
  "full_mc_name"      VARCHAR(300),
  "winter_status"     VARCHAR(20),
  "uploaded_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "broader_menu_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "broader_menu_mc_cd_key"        ON "broader_menu"("mc_cd");
CREATE INDEX IF NOT EXISTS "broader_menu_seg_div_sub_div_idx"      ON "broader_menu"("seg", "div", "sub_div");
CREATE INDEX IF NOT EXISTS "broader_menu_maj_cat_cd_idx"           ON "broader_menu"("maj_cat_cd");
CREATE INDEX IF NOT EXISTS "broader_menu_sub_cat_cd_idx"           ON "broader_menu"("sub_cat_cd");
CREATE INDEX IF NOT EXISTS "broader_menu_mc_stat_idx"              ON "broader_menu"("mc_stat");
