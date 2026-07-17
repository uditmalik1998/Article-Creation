-- Article-level record of promotion to the E-commerce/ folder in the model-images bucket.
-- One row per article number (color-specific, e.g. "1110106859-DARK GREY").
CREATE TABLE IF NOT EXISTS public.model_image_approvals (
  id             text         PRIMARY KEY,
  article_number varchar(100) NOT NULL,
  approved_by    integer,
  approved_at    timestamp(3) NOT NULL DEFAULT now(),
  ecommerce_urls jsonb,
  created_at     timestamp(3) NOT NULL DEFAULT now(),
  updated_at     timestamp(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS model_image_approvals_article_number_key
  ON public.model_image_approvals (article_number);

CREATE INDEX IF NOT EXISTS model_image_approvals_approved_by_idx
  ON public.model_image_approvals (approved_by);
