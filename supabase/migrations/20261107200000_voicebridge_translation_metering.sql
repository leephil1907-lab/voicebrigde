-- Metered translation credits, subscription allowances and automatic refunds.
-- 60 credits represent one billable minute. Every translation reserves credits before
-- it becomes visible to the durable worker. Job completion settles the reservation;
-- terminal failure refunds it automatically through a database trigger.

create table if not exists public.voicebridge_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null unique references public.voicebridge_jobs(id) on delete cascade,
  credits_reserved bigint not null check (credits_reserved > 0),
  duration_seconds numeric(12,3) not null check (duration_seconds > 0),
  funding_source text not null check (funding_source in ('subscription', 'credits', 'mixed')),
  subscription_credits bigint not null default 0 check (subscription_credits >= 0),
  wallet_credits bigint not null default 0 check (wallet_credits >= 0),
  plan_code text,
  constraint voicebridge_credit_reservation_split_check check (subscription_credits + wallet_credits = credits_reserved),
  period_start timestamptz,
  period_end timestamptz,
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'refunded')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  refunded_at timestamptz
);
create index if not exists voicebridge_credit_reservations_owner_idx
  on public.voicebridge_credit_reservations(user_id, created_at desc);
create index if not exists voicebridge_credit_reservations_period_idx
  on public.voicebridge_credit_reservations(user_id, period_start, period_end)
  where subscription_credits > 0 and status in ('reserved', 'settled');

alter table public.voicebridge_credit_reservations enable row level security;
revoke all on public.voicebridge_credit_reservations from anon, authenticated;
grant select on public.voicebridge_credit_reservations to authenticated;
grant all on public.voicebridge_credit_reservations to service_role;
drop policy if exists "Users can read own credit reservations" on public.voicebridge_credit_reservations;
create policy "Users can read own credit reservations"
  on public.voicebridge_credit_reservations for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.ensure_voicebridge_credit_account(p_user_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_user uuid;
  available bigint;
begin
  insert into public.voicebridge_credit_accounts(user_id, currency, available_credits, updated_at)
  values (p_user_id, 'CRD', 60, now())
  on conflict (user_id) do nothing
  returning user_id into inserted_user;

  if inserted_user is not null then
    insert into public.voicebridge_credit_transactions(
      user_id, amount, currency, transaction_type, reference_type,
      reference_id, idempotency_key, description
    ) values (
      p_user_id, 60, 'CRD', 'grant', 'free_trial', p_user_id::text,
      'free-trial-v1', 'One-time VoiceBridge one-minute trial allowance'
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  select available_credits into available
  from public.voicebridge_credit_accounts where user_id = p_user_id;
  return coalesce(available, 0);
end;
$$;
revoke all on function public.ensure_voicebridge_credit_account(uuid) from public, anon, authenticated;
grant execute on function public.ensure_voicebridge_credit_account(uuid) to service_role;

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
  required_credits bigint;
  subscription_row public.voicebridge_subscriptions;
  included_credits bigint := 0;
  used_credits bigint := 0;
  account_row public.voicebridge_credit_accounts;
  inserted_user uuid;
  reservation public.voicebridge_credit_reservations;
  subscription_available bigint := 0;
  subscription_charge bigint := 0;
  wallet_charge bigint := 0;
begin
  if p_duration_seconds is null or p_duration_seconds <= 0 or p_duration_seconds > 3600 then
    raise exception 'INVALID_AUDIO_DURATION';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text), 0);
  select * into reservation from public.voicebridge_credit_reservations
    where job_id = p_job_id;
  if found then
    return jsonb_build_object(
      'reserved', true, 'alreadyReserved', true,
      'credits', reservation.credits_reserved,
      'minutes', ceil(p_duration_seconds / 60.0),
      'fundingSource', reservation.funding_source
    );
  end if;

  required_credits := ceil(p_duration_seconds / 60.0)::bigint * 60;

  select * into subscription_row
  from public.voicebridge_subscriptions
  where user_id = p_user_id
    and provider = 'paystack'
    and status in ('active', 'trialing')
    and current_period_start <= now()
    and current_period_end > now()
  order by created_at desc
  limit 1
  for update;

  if found then
    included_credits := coalesce(nullif(subscription_row.metadata->>'includedMinutes', '')::bigint, 0) * 60;
    select coalesce(sum(subscription_credits), 0) into used_credits
    from public.voicebridge_credit_reservations
    where user_id = p_user_id
      and subscription_credits > 0
      and status in ('reserved', 'settled')
      and period_start = subscription_row.current_period_start
      and period_end = subscription_row.current_period_end;

    subscription_available := greatest(included_credits - used_credits, 0);
    subscription_charge := least(required_credits, subscription_available);
  end if;
  wallet_charge := required_credits - subscription_charge;

  -- A one-time 60-credit (one minute) trial is granted only when a wallet is first needed.
  if wallet_charge > 0 then
    insert into public.voicebridge_credit_accounts(user_id, currency, available_credits, updated_at)
    values (p_user_id, 'CRD', 60, now())
    on conflict (user_id) do nothing
    returning user_id into inserted_user;
    if inserted_user is not null then
      insert into public.voicebridge_credit_transactions(
        user_id, amount, currency, transaction_type, reference_type,
        reference_id, idempotency_key, description
      ) values (
        p_user_id, 60, 'CRD', 'grant', 'free_trial', p_user_id::text,
        'free-trial-v1', 'One-time VoiceBridge one-minute trial allowance'
      ) on conflict (user_id, idempotency_key) do nothing;
    end if;

    select * into account_row from public.voicebridge_credit_accounts
      where user_id = p_user_id for update;
    if account_row.available_credits < wallet_charge then
      -- Return normally so a newly created trial balance persists even when
      -- this recording is longer than the available credits.
      return jsonb_build_object(
        'reserved', false, 'insufficientCredits', true,
        'creditsAvailable', account_row.available_credits,
        'creditsRequired', wallet_charge,
        'subscriptionCreditsAvailable', subscription_available
      );
    end if;

    update public.voicebridge_credit_accounts
      set available_credits = available_credits - wallet_charge,
          currency = 'CRD', updated_at = now()
      where user_id = p_user_id;

    insert into public.voicebridge_credit_transactions(
      user_id, amount, currency, transaction_type, reference_type,
      reference_id, idempotency_key, description
    ) values (
      p_user_id, -wallet_charge, 'CRD', 'usage', 'translation_job',
      p_job_id::text, 'translation:' || p_job_id::text,
      'Reserved translation audio minutes'
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  insert into public.voicebridge_credit_reservations(
    user_id, job_id, credits_reserved, duration_seconds, funding_source,
    subscription_credits, wallet_credits, plan_code, period_start, period_end
  ) values (
    p_user_id, p_job_id, required_credits, p_duration_seconds,
    case when subscription_charge > 0 and wallet_charge > 0 then 'mixed'
         when subscription_charge > 0 then 'subscription' else 'credits' end,
    subscription_charge, wallet_charge,
    coalesce(subscription_row.plan_code, 'free'),
    case when subscription_charge > 0 then subscription_row.current_period_start else null end,
    case when subscription_charge > 0 then subscription_row.current_period_end else null end
  ) returning * into reservation;

  update public.voicebridge_jobs set available_at = now(), updated_at = now()
    where id = p_job_id and user_id = p_user_id and status = 'queued';
  if not found then raise exception 'TRANSLATION_JOB_NOT_QUEUEABLE'; end if;

  return jsonb_build_object(
    'reserved', true, 'alreadyReserved', false, 'credits', required_credits,
    'minutes', ceil(p_duration_seconds / 60.0),
    'fundingSource', reservation.funding_source,
    'subscriptionCredits', subscription_charge,
    'walletCredits', wallet_charge,
    'creditsRemaining', case when wallet_charge > 0 then account_row.available_credits - wallet_charge else null end,
    'subscriptionMinutesRemaining', floor((subscription_available - subscription_charge) / 60.0)
  );
end;
$$;
revoke all on function public.reserve_voicebridge_translation(uuid,uuid,numeric) from public, anon, authenticated;
grant execute on function public.reserve_voicebridge_translation(uuid,uuid,numeric) to service_role;

create or replace function public.finalize_voicebridge_translation_billing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reservation public.voicebridge_credit_reservations;
begin
  if new.status not in ('completed', 'failed') or old.status = new.status then
    return new;
  end if;

  select * into reservation
  from public.voicebridge_credit_reservations
  where job_id = new.id and status = 'reserved'
  for update;
  if not found then return new; end if;

  if new.status = 'completed' then
    update public.voicebridge_credit_reservations
      set status = 'settled', settled_at = now()
      where id = reservation.id;

    insert into public.voicebridge_usage_events(
      user_id, job_id, event_type, quantity, unit, plan_code,
      credits_charged, metadata, idempotency_key
    ) values (
      reservation.user_id, new.id, 'translation_completed',
      reservation.duration_seconds, 'seconds', reservation.plan_code,
      reservation.credits_reserved,
      jsonb_build_object('fundingSource', reservation.funding_source),
      'translation-completed:' || new.id::text
    ) on conflict (user_id, idempotency_key) do nothing;
  else
    update public.voicebridge_credit_reservations
      set status = 'refunded', refunded_at = now()
      where id = reservation.id;

    if reservation.wallet_credits > 0 then
      insert into public.voicebridge_credit_accounts(user_id, currency, available_credits, updated_at)
      values (reservation.user_id, 'CRD', reservation.wallet_credits, now())
      on conflict (user_id) do update
        set available_credits = public.voicebridge_credit_accounts.available_credits + excluded.available_credits,
            currency = 'CRD', updated_at = now();

      insert into public.voicebridge_credit_transactions(
        user_id, amount, currency, transaction_type, reference_type,
        reference_id, idempotency_key, description
      ) values (
        reservation.user_id, reservation.wallet_credits, 'CRD', 'refund',
        'translation_job', new.id::text, 'translation-refund:' || new.id::text,
        'Automatic refund for failed translation'
      ) on conflict (user_id, idempotency_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.finalize_voicebridge_translation_billing() from public, anon, authenticated;
drop trigger if exists voicebridge_translation_billing_finalize on public.voicebridge_jobs;
create trigger voicebridge_translation_billing_finalize
  after update of status on public.voicebridge_jobs
  for each row execute function public.finalize_voicebridge_translation_billing();

-- Credit balances are denominated in internal credits, not currency.
update public.voicebridge_credit_accounts set currency = 'CRD' where currency <> 'CRD';
update public.voicebridge_credit_transactions set currency = 'CRD' where currency <> 'CRD';

-- If API cleanup deletes a job after an ambiguous network result, restore any
-- still-reserved wallet credits. Settled translations are never refunded here.
create or replace function public.refund_voicebridge_translation_on_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reservation public.voicebridge_credit_reservations;
begin
  select * into reservation
  from public.voicebridge_credit_reservations
  where job_id = old.id and status = 'reserved'
  for update;
  if not found then return old; end if;

  update public.voicebridge_credit_reservations
    set status = 'refunded', refunded_at = now()
    where id = reservation.id;

  if reservation.wallet_credits > 0 then
    insert into public.voicebridge_credit_accounts(user_id, currency, available_credits, updated_at)
    values (reservation.user_id, 'CRD', reservation.wallet_credits, now())
    on conflict (user_id) do update
      set available_credits = public.voicebridge_credit_accounts.available_credits + excluded.available_credits,
          currency = 'CRD', updated_at = now();

    insert into public.voicebridge_credit_transactions(
      user_id, amount, currency, transaction_type, reference_type,
      reference_id, idempotency_key, description
    ) values (
      reservation.user_id, reservation.wallet_credits, 'CRD', 'refund',
      'translation_job', old.id::text, 'translation-delete-refund:' || old.id::text,
      'Automatic refund for a cancelled queued translation'
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.refund_voicebridge_translation_on_delete() from public, anon, authenticated;
drop trigger if exists voicebridge_translation_billing_delete on public.voicebridge_jobs;
create trigger voicebridge_translation_billing_delete
  before delete on public.voicebridge_jobs
  for each row execute function public.refund_voicebridge_translation_on_delete();
