-- Ensure the paid-credit path never creates the legacy pooled free-credit grant.
create or replace function public.reserve_voicebridge_translation(
  p_user_id uuid,
  p_job_id uuid,
  p_duration_seconds numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  paid_result jsonb;
  trial_row public.voicebridge_free_trials;
  existing_trial public.voicebridge_free_trial_reservations;
begin
  if p_duration_seconds is null or p_duration_seconds <= 0 or p_duration_seconds > 3600 then
    raise exception 'INVALID_AUDIO_DURATION';
  end if;

  select * into existing_trial
  from public.voicebridge_free_trial_reservations
  where job_id = p_job_id and user_id = p_user_id;
  if found then
    return jsonb_build_object('reserved', true, 'alreadyReserved', true, 'credits', 0,
      'minutes', ceil(p_duration_seconds / 60.0), 'fundingSource', 'trial');
  end if;

  -- Create a zero-credit wallet first; this also protects older API instances
  -- that call this RPC without first requesting the account overview.
  perform public.ensure_voicebridge_credit_account(p_user_id);

  paid_result := public.reserve_voicebridge_translation_paid(p_user_id, p_job_id, p_duration_seconds);
  if coalesce((paid_result->>'reserved')::boolean, false)
     or not coalesce((paid_result->>'insufficientCredits')::boolean, false) then
    return paid_result;
  end if;

  if p_duration_seconds > 120
     or coalesce((paid_result->>'subscriptionCreditsAvailable')::bigint, 0) > 0 then
    return paid_result;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), 0);
  select * into trial_row from public.voicebridge_free_trials
  where user_id = p_user_id for update;
  if not found or trial_row.attempts_remaining <= 0 then return paid_result; end if;

  update public.voicebridge_free_trials
  set attempts_remaining = attempts_remaining - 1, updated_at = now()
  where user_id = p_user_id returning * into trial_row;

  insert into public.voicebridge_free_trial_reservations(user_id, job_id, status)
  values (p_user_id, p_job_id, 'reserved');

  update public.voicebridge_jobs set available_at = now(), updated_at = now()
  where id = p_job_id and user_id = p_user_id and status = 'queued';
  if not found then raise exception 'TRANSLATION_JOB_NOT_QUEUEABLE'; end if;

  return jsonb_build_object('reserved', true, 'alreadyReserved', false, 'credits', 0,
    'minutes', ceil(p_duration_seconds / 60.0), 'fundingSource', 'trial',
    'trialAttemptsRemaining', trial_row.attempts_remaining);
end;
$$;
revoke all on function public.reserve_voicebridge_translation(uuid,uuid,numeric) from public, anon, authenticated;
grant execute on function public.reserve_voicebridge_translation(uuid,uuid,numeric) to service_role;