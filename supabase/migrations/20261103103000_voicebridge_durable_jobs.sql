-- VoiceBridge durable jobs, per-user isolation, and private audio storage.
create table if not exists public.voicebridge_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  stage text not null default 'queued',
  source_language text,
  target_language text not null,
  source_transcript text not null default '',
  translated_transcript text not null default '',
  input_path text not null,
  output_path text,
  provider_project_id text,
  provider_language_id text,
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint voicebridge_target_language_not_empty check (length(target_language) between 2 and 12)
);

create index if not exists voicebridge_jobs_user_created_idx
  on public.voicebridge_jobs (user_id, created_at desc);
create index if not exists voicebridge_jobs_queue_idx
  on public.voicebridge_jobs (available_at, created_at)
  where status = 'queued';
create index if not exists voicebridge_jobs_expired_lease_idx
  on public.voicebridge_jobs (locked_at)
  where status = 'processing';

grant usage on schema public to authenticated, service_role;

alter table public.voicebridge_jobs enable row level security;
revoke all on table public.voicebridge_jobs from anon, authenticated;
grant select on table public.voicebridge_jobs to authenticated;
grant all on table public.voicebridge_jobs to service_role;

drop policy if exists "Users can read their own VoiceBridge jobs" on public.voicebridge_jobs;
create policy "Users can read their own VoiceBridge jobs"
  on public.voicebridge_jobs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Atomic queue claim: competing workers cannot claim the same live job.
create or replace function public.claim_voicebridge_job(p_worker_id text)
returns setof public.voicebridge_jobs
language sql
security definer
set search_path = ''
as $$
  with exhausted as (
    update public.voicebridge_jobs
    set status = 'failed', stage = 'failed',
        error = coalesce(error, 'Worker lease expired after maximum attempts'),
        locked_at = null, locked_by = null, updated_at = now()
    where status = 'processing'
      and locked_at < now() - interval '2 minutes'
      and attempts >= max_attempts
    returning id
  ),
  candidate as (
    select id
    from public.voicebridge_jobs
    where available_at <= now()
      and attempts < max_attempts
      and (
        status = 'queued'
        or (status = 'processing' and locked_at < now() - interval '2 minutes')
      )
    order by available_at asc, created_at asc
    for update skip locked
    limit 1
  )
  update public.voicebridge_jobs as job
  set status = 'processing',
      stage = case when job.provider_project_id is null then 'uploading_source' else coalesce(nullif(job.stage, 'queued'), 'resuming') end,
      attempts = job.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  from candidate
  where job.id = candidate.id
  returning job.*;
$$;

revoke all on function public.claim_voicebridge_job(text) from public, anon, authenticated;
grant execute on function public.claim_voicebridge_job(text) to service_role;

create or replace function public.heartbeat_voicebridge_job(p_job_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.voicebridge_jobs
  set locked_at = now(), updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and locked_by = p_worker_id;
  return found;
end;
$$;

revoke all on function public.heartbeat_voicebridge_job(uuid, text) from public, anon, authenticated;
grant execute on function public.heartbeat_voicebridge_job(uuid, text) to service_role;

-- Keep the bucket private. Only the API/worker service role accesses audio objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voicebridge-private', 'voicebridge-private', false, 20971520,
        array['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Users may only access objects under their own UUID folder if using the Storage API.
drop policy if exists "Users can read own VoiceBridge audio" on storage.objects;
create policy "Users can read own VoiceBridge audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voicebridge-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can upload own VoiceBridge audio" on storage.objects;
create policy "Users can upload own VoiceBridge audio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voicebridge-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- The application uses the service role for object access and explicit owner checks.
