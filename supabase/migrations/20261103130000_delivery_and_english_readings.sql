-- Official-channel delivery jobs, explicit recipient linking, and text-only readings.
-- All client access is owner-scoped and read-only. Workers use service_role.

create table if not exists public.voicebridge_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  translation_job_id uuid not null references public.voicebridge_jobs(id) on delete cascade,
  channel text not null check (channel in ('whatsapp_business', 'telegram')),
  recipient text not null,
  recipient_label text not null default '',
  idempotency_key uuid not null,
  status text not null default 'queued' check (status in ('queued','processing','accepted','sent','delivered','read','failed','unknown')),
  recipient_consented_at timestamptz not null,
  preview_confirmed_at timestamptz not null,
  provider_message_id text,
  provider_media_id text,
  provider_attempted_at timestamptz,
  error text,
  attempts integer not null default 0 check (attempts between 0 and 10),
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create unique index if not exists voicebridge_delivery_provider_idx
  on public.voicebridge_deliveries (channel, provider_message_id) where provider_message_id is not null;
create index if not exists voicebridge_delivery_queue_idx on public.voicebridge_deliveries (available_at, created_at) where status = 'queued';
create index if not exists voicebridge_delivery_owner_idx on public.voicebridge_deliveries (user_id, created_at desc);
create index if not exists voicebridge_delivery_translation_idx on public.voicebridge_deliveries (translation_job_id);

create table if not exists public.voicebridge_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  source_language text,
  source_text text not null,
  english_text text not null default '',
  translation_status text not null check (translation_status in ('completed','unavailable')),
  processing_consented_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists voicebridge_readings_owner_idx on public.voicebridge_readings (user_id, created_at desc);

create table if not exists public.voicebridge_telegram_links (
  code_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.voicebridge_telegram_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  display_name text not null,
  linked_at timestamptz not null default now(),
  unique (user_id, chat_id)
);

do $$ declare t text; begin
  foreach t in array array['voicebridge_deliveries','voicebridge_readings','voicebridge_telegram_links','voicebridge_telegram_recipients'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    if t <> 'voicebridge_telegram_links' then
      execute format('grant select on table public.%I to authenticated', t);
      execute format('drop policy if exists "Owner reads %I" on public.%I', t, t);
      execute format('create policy "Owner reads %I" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t, t);
    end if;
  end loop;
end $$;

create or replace function public.link_voicebridge_telegram(p_code_hash text, p_chat_id text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare link_row public.voicebridge_telegram_links; owner_id uuid;
begin
  select * into link_row from public.voicebridge_telegram_links
    where code_hash = p_code_hash for update;
  if not found or link_row.used_at is not null or link_row.expires_at <= now() then return null; end if;
  insert into public.voicebridge_telegram_recipients (user_id, chat_id, display_name)
    values (link_row.user_id, p_chat_id, left(p_name, 120))
    on conflict (user_id, chat_id) do update set display_name = excluded.display_name, linked_at = now();
  update public.voicebridge_telegram_links set used_at = now(), chat_id = p_chat_id where code_hash = p_code_hash;
  owner_id := link_row.user_id;
  return owner_id;
end $$;

create or replace function public.claim_voicebridge_delivery(p_worker_id text)
returns setof public.voicebridge_deliveries language sql security definer set search_path = '' as $$
  with ambiguous as (
    update public.voicebridge_deliveries set status = 'unknown',
      error = 'The worker stopped after a delivery attempt. Check the recipient before sending again to avoid a duplicate.',
      locked_at = null, locked_by = null, updated_at = now()
    where status = 'processing' and locked_at < now() - interval '2 minutes' and provider_attempted_at is not null
    returning id
  ), exhausted as (
    update public.voicebridge_deliveries set status = 'failed',
      error = coalesce(error, 'Delivery worker lease expired after maximum attempts.'),
      locked_at = null, locked_by = null, updated_at = now()
    where status = 'processing' and locked_at < now() - interval '2 minutes'
      and attempts >= max_attempts and provider_attempted_at is null
    returning id
  ), candidate as (
    select id from public.voicebridge_deliveries
    where provider_attempted_at is null and attempts < max_attempts and available_at <= now()
      and (status = 'queued' or (status = 'processing' and locked_at < now() - interval '2 minutes'))
    order by available_at, created_at for update skip locked limit 1
  )
  update public.voicebridge_deliveries d set status = 'processing', attempts = attempts + 1,
    locked_at = now(), locked_by = p_worker_id, updated_at = now()
  from candidate where d.id = candidate.id returning d.*;
$$;

create or replace function public.heartbeat_voicebridge_delivery(p_job_id uuid, p_worker_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.voicebridge_deliveries set locked_at = now(), updated_at = now()
    where id = p_job_id and status = 'processing' and locked_by = p_worker_id;
  return found;
end $$;

do $$ begin
  revoke all on function public.link_voicebridge_telegram(text,text,text) from public, anon, authenticated;
  grant execute on function public.link_voicebridge_telegram(text,text,text) to service_role;
  revoke all on function public.claim_voicebridge_delivery(text) from public, anon, authenticated;
  grant execute on function public.claim_voicebridge_delivery(text) to service_role;
  revoke all on function public.heartbeat_voicebridge_delivery(uuid,text) from public, anon, authenticated;
  grant execute on function public.heartbeat_voicebridge_delivery(uuid,text) to service_role;
end $$;
