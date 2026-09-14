-- Drop the incorrectly-named cmpt_cost column and add correctly-named cmtp_cost
ALTER TABLE public.body_article_data DROP COLUMN IF EXISTS cmpt_cost;
ALTER TABLE public.body_article_data ADD COLUMN IF NOT EXISTS cmtp_cost NUMERIC(10,2);
