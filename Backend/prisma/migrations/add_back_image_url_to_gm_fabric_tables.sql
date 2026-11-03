-- Back photo (front stays in image_url). Nullable; filled only when SRM sends it.
ALTER TABLE public.gm_raw_data         ADD COLUMN IF NOT EXISTS back_image_url TEXT;
ALTER TABLE public.fabric_raw_data     ADD COLUMN IF NOT EXISTS back_image_url TEXT;
ALTER TABLE public.gm_article_data     ADD COLUMN IF NOT EXISTS back_image_url TEXT;
ALTER TABLE public.fabric_article_data ADD COLUMN IF NOT EXISTS back_image_url TEXT;
