-- Back photo of an SRM raw article (front stays in image_url). Nullable.
ALTER TABLE public.raw_articles ADD COLUMN IF NOT EXISTS back_image_url TEXT;
