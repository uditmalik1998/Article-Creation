-- FG Created tab image replace: image_url = the new image (<article>.jpg),
-- old_image_url = the image it replaced (<article>_OLD.jpg in the approved bucket).
ALTER TABLE extraction_results_flat ADD COLUMN IF NOT EXISTS old_image_url TEXT;
