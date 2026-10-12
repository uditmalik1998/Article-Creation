ALTER TABLE public.body_article_data
  DROP COLUMN IF EXISTS basic_trim_cost,
  DROP COLUMN IF EXISTS costing_type;
