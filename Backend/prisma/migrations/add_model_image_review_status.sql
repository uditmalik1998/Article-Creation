-- Adds review status to model_image_approvals so the gallery can distinguish
-- APPROVED / REJECTED / REVERTED (an article with no row = never reviewed).
--
-- approved_by / approved_at keep their original meaning (the LAST approval), so a
-- reverted or rejected article still shows who had approved it. reviewed_by /
-- reviewed_at track the most recent action of any kind.
--
-- Safe to re-run.

ALTER TABLE public.model_image_approvals
  ADD COLUMN IF NOT EXISTS status      varchar(20)  NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS reviewed_by integer,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp(3) NOT NULL DEFAULT now();

-- Existing rows were all approvals: seed the review columns from the approval columns.
UPDATE public.model_image_approvals
   SET reviewed_by = approved_by,
       reviewed_at = approved_at
 WHERE reviewed_by IS NULL;

CREATE INDEX IF NOT EXISTS model_image_approvals_status_idx
  ON public.model_image_approvals (status);
