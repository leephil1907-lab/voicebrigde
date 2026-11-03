-- Avoid automatic duplicate billable provider creations after a lost worker lease.
create or replace function public.claim_voicebridge_job(p_worker_id text)
returns setof public.voicebridge_jobs
language sql
security definer
set search_path = ''
as $$
  with ambiguous as (
    update public.voicebridge_jobs set status = 'failed', stage = 'failed',
      error = 'Provider creation was interrupted. Check the ElevenLabs dashboard for charges before submitting again.',
      locked_at = null, locked_by = null, updated_at = now()
    where status = 'processing' and locked_at < now() - interval '2 minutes'
      and ((stage = 'creating_dubbing_project' and provider_project_id is null)
        or (stage = 'creating_target_language' and provider_language_id is null))
    returning id
  ), exhausted as (
    update public.voicebridge_jobs
    set status = 'failed', stage = 'failed',
        error = coalesce(error, 'Worker lease expired after maximum attempts'),
        locked_at = null, locked_by = null, updated_at = now()
    where status = 'processing'
      and not ((stage = 'creating_dubbing_project' and provider_project_id is null) or (stage = 'creating_target_language' and provider_language_id is null))
      and locked_at < now() - interval '2 minutes'
      and attempts >= max_attempts
    returning id
  ),
  candidate as (
    select id
    from public.voicebridge_jobs
    where not (status = 'processing' and ((stage = 'creating_dubbing_project' and provider_project_id is null) or (stage = 'creating_target_language' and provider_language_id is null)))
      and available_at <= now()
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
