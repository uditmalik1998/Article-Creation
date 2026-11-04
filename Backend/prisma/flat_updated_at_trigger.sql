-- Keeps extraction_results_flat.updated_at correct for EVERY write, not only Prisma ones.
-- Prisma's @updatedAt only fires for Prisma create/update; raw SQL (syncSetsFromRaw,
-- creator/modify_user JSONB, backfills, scripts) left updated_at stale, so the nightly
-- Snowflake sync (C:\jobs\snowflake-sync\sync_flat.py), which picks rows by updated_at,
-- would miss those changes.
-- Updates that only touch sap_lock_until (SAP queue lock) are ignored so they don't
-- count as a change. Stored in UTC like Prisma does.

create or replace function public.flat_set_updated_at() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := coalesce(new.updated_at, now() at time zone 'utc');
    return new;
  end if;
  -- Ignore updates that only touch the SAP lock (or change nothing).
  if (to_jsonb(new) - 'sap_lock_until' - 'updated_at') = (to_jsonb(old) - 'sap_lock_until' - 'updated_at') then
    return new;
  end if;
  new.updated_at := now() at time zone 'utc';
  return new;
end $$;

drop trigger if exists trg_flat_set_updated_at on public.extraction_results_flat;
create trigger trg_flat_set_updated_at
  before insert or update on public.extraction_results_flat
  for each row execute function public.flat_set_updated_at();

comment on function public.flat_set_updated_at() is
  'Keeps extraction_results_flat.updated_at correct for every write (Prisma, raw SQL, scripts). Skips sap_lock_until-only updates. Used by the nightly Snowflake sync.';
