-- Replace pooled free minutes with three independent, two-minute trial translations.
-- Only accounts created after this migration receive trial attempts. Existing balances remain untouched.

create table if not exists public.voicebridge_free_trials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempts_remaining integer not null default 3 check (attempts_remaining between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.voicebridge_free_trial_reservations (
  job_id uuid primary key references public.voicebridge_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'reserved' check (status in ('reserved','consumed','released')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists voicebridge_free_trial_reservations_user_idx
  on public.voicebridge_free_trial_reservations(user_id, created_at desc);

alter table public.voicebridge_free_trials enable row level security;
alter table public.voicebridge_free_trial_reservations enable row level security;
revoke all on public.voicebridge_free_trials, public.voicebridge_free_trial_reservations from anon, authenticated;
grant all on public.voicebridge_free_trials, public.voicebridge_free_trial_reservations to service_role;

create or replace function public.create_voicebridge_free_trial_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.voicebridge_free_trials(user_id, attempts_remaining)
  values (new.id, 3)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_voicebridge_free_trial_for_new_user() from public, anon, authenticated;
drop trigger if exists voicebridge_new_user_free_trial on auth.users;
create trigger voicebridge_new_user_free_trial
  after insert on auth.users
  for each row execute function public.create_voicebridge_free_trial_for_new_user();

-- The account row is still created for billing, but new users no longer receive pooled credits.
create or replace function public.ensure_voicebridge_credit_account(p_user_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare available bigint;
begin
  insert into public.voicebridge_credit_accounts(user_id, currency, available_credits, updated_at)
  values (p_user_id, 'CRD', 0, now())
  on conflict (user_id) do nothing;
  select available_credits into available
  from public.voicebridge_credit_accounts where user_id = p_user_id;
  return coalesce(available, 0);
end;
$$;
revoke all on function public.ensure_voicebridge_credit_account(uuid) from public, anon, authenticated;
grant execute on function public.ensure_voicebridge_credit_account(uuid) to service_role;

-- Keep the established subscription/wallet billing implementation as the paid-credit path.
alter function public.reserve_voicebridge_translation(uuid, uuid, numeric)
  rename to reserve_voicebridge_translation_paid;

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
    return jsonb_build_object(
      'reserved', true, 'alreadyReserved', true, 'credits', 0,
      'minutes', ceil(p_duration_seconds / 60.0),
      'fundingSource', 'trial'
    );
  end if;

  paid_result := public.reserve_voicebridge_translation_paid(p_user_id, p_job_id, p_duration_seconds);
  if coalesce((paid_result->>'reserved')::boolean, false)
     or not coalesce((paid_result->>'insufficientCredits')::boolean, false) then
    return paid_result;
  end if;

  -- Trial entitlement applies only to a complete recording of at most two minutes.
  -- Do not use it to top up a partially available paid subscription allowance.
  if p_duration_seconds > 120
     or coalesce((paid_result->>'subscriptionCreditsAvailable')::bigint, 0) > 0 then
    return paid_result;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text), 0);
  select * into trial_row
  from public.voicebridge_free_trials
  where user_id = p_user_id
  for update;
  if not found or trial_row.attempts_remaining <= 0 then
    return paid_result;
  end if;

  update public.voicebridge_free_trials
  set attempts_remaining = attempts_remaining - 1, updated_at = now()
  where user_id = p_user_id
  returning * into trial_row;

  insert into public.voicebridge_free_trial_reservations(user_id, job_id, status)
  values (p_user_id, p_job_id, 'reserved');

  update public.voicebridge_jobs
  set available_at = now(), updated_at = now()
  where id = p_job_id and user_id = p_user_id and status = 'queued';
  if not found then raise exception 'TRANSLATION_JOB_NOT_QUEUEABLE'; end if;

  return jsonb_build_object(
    'reserved', true, 'alreadyReserved', false, 'credits', 0,
    'minutes', ceil(p_duration_seconds / 60.0),
    'fundingSource', 'trial',
    'trialAttemptsRemaining', trial_row.attempts_remaining
  );
end;
$$;
revoke all on function public.reserve_voicebridge_translation(uuid,uuid,numeric) from public, anon, authenticated;
grant execute on function public.reserve_voicebridge_translation(uuid,uuid,numeric) to service_role;

create or replace function public.finalize_voicebridge_free_trial()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare trial_reservation public.voicebridge_free_trial_reservations;
begin
  if new.status not in ('completed','failed') or old.status = new.status then
    return new;
  end if;

  select * into trial_reservation
  from public.voicebridge_free_trial_reservations
  where job_id = new.id and status = 'reserved'
  for update;
  if not found then return new; end if;

  if new.status = 'completed' then
    update public.voicebridge_free_trial_reservations
    set status = 'consumed', finished_at = now()
    where job_id = new.id;
  else
    update public.voicebridge_free_trial_reservations
    set status = 'released', finished_at = now()
    where job_id = new.id;
    update public.voicebridge_free_trials
    set attempts_remaining = least(3, attempts_remaining + 1), updated_at = now()
    where user_id = trial_reservation.user_id;
  end if;
  return new;
end;
$$;
revoke all on function public.finalize_voicebridge_free_trial() from public, anon, authenticated;
drop trigger if exists voicebridge_free_trial_finalize on public.voicebridge_jobs;
create trigger voicebridge_free_trial_finalize
  after update of status on public.voicebridge_jobs
  for each row execute function public.finalize_voicebridge_free_trial();

create or replace function public.release_voicebridge_free_trial_on_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare trial_reservation public.voicebridge_free_trial_reservations;
begin
  select * into trial_reservation
  from public.voicebridge_free_trial_reservations
  where job_id = old.id and status = 'reserved'
  for update;
  if found then
    update public.voicebridge_free_trial_reservations
    set status = 'released', finished_at = now()
    where job_id = old.id;
    update public.voicebridge_free_trials
    set attempts_remaining = least(3, attempts_remaining + 1), updated_at = now()
    where user_id = trial_reservation.user_id;
  end if;
  return old;
end;
$$;
revoke all on function public.release_voicebridge_free_trial_on_delete() from public, anon, authenticated;
drop trigger if exists voicebridge_free_trial_delete on public.voicebridge_jobs;
create trigger voicebridge_free_trial_delete
  before delete on public.voicebridge_jobs
  for each row execute function public.release_voicebridge_free_trial_on_delete();
