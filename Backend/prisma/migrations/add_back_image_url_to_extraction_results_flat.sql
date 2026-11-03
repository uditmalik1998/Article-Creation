-- Back photo of an article (front stays in image_url). Nullable.
ALTER TABLE public.extraction_results_flat ADD COLUMN IF NOT EXISTS back_image_url TEXT;
