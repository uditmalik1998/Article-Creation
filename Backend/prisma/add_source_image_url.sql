-- source_image_url: the clean (un-watermarked) image of an FG article.
-- image_url is overwritten with the watermarked approved-bucket copy when the article
-- is created in SAP; source_image_url keeps the original so a Created-page KIDS
-- duplicate starts from the clean image instead of stamping a second watermark.

alter table public.extraction_results_flat add column if not exists source_image_url text;

comment on column public.extraction_results_flat.source_image_url is
  'Clean (un-watermarked) image. Follows image_url until the article is approved / SAP-synced; the approval watermark overwrites image_url but never this. Used by the Created-page KIDS duplicate.';

-- Every insert path (FG page / Watcher extraction, SRM raw_articles VLM, combo child,
-- duplicates) gets it from image_url; a pre-approval image change keeps it in step.
create or replace function public.set_flat_source_image_url()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.source_image_url is null or new.source_image_url = '' then
      new.source_image_url := nullif(new.image_url, '');
    end if;
  elsif new.image_url is distinct from old.image_url
        and new.source_image_url is not distinct from old.source_image_url
        and new.approval_status <> 'APPROVED'
        and new.sap_sync_status <> 'SYNCED' then
    new.source_image_url := nullif(new.image_url, '');
  end if;
  return new;
end $$;

drop trigger if exists trg_set_flat_source_image_url on public.extraction_results_flat;
create trigger trg_set_flat_source_image_url
  before insert or update of image_url on public.extraction_results_flat
  for each row execute function public.set_flat_source_image_url();

-- Backfill 1: not yet approved — image_url is still the clean image.
update public.extraction_results_flat
set source_image_url = nullif(image_url, '')
where source_image_url is null
  and approval_status <> 'APPROVED';

-- Backfill 2: approved — image_url is watermarked; take the original from SRM
-- raw_articles, else from the extraction job (SRM jobs carry an empty URL).
update public.extraction_results_flat f
set source_image_url = coalesce(nullif(r.image_url, ''), nullif(j.image_url, ''))
from public.extraction_results_flat f2
left join public.raw_articles r on r.id::text = f2.srm_unique_id
left join public.extraction_jobs j on j.id = f2.job_id
where f.id = f2.id
  and f.source_image_url is null
  and f.approval_status = 'APPROVED'
  and coalesce(nullif(r.image_url, ''), nullif(j.image_url, '')) is not null;
