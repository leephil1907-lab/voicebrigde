-- Increase the one-time allowance for newly created VoiceBridge accounts
-- from one billable minute (60 credits) to three billable minutes (180 credits).
-- Existing accounts and already-issued trial balances are intentionally unchanged.

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
  values (p_user_id, 'CRD', 180, now())
  on conflict (user_id) do nothing
  returning user_id into inserted_user;

  if inserted_user is not null then
    insert into public.voicebridge_credit_transactions(
      user_id, amount, currency, transaction_type, reference_type,
      reference_id, idempotency_key, description
    ) values (
      p_user_id, 180, 'CRD', 'grant', 'free_trial', p_user_id::text,
      'free-trial-v2', 'One-time VoiceBridge three-minute trial allowance'
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

  -- Grant three billable minutes only when a new wallet account is first needed.
  if wallet_charge > 0 then
    insert into public.voicebridge_credit_accounts(user_id, currency, available_credits, updated_at)
    values (p_user_id, 'CRD', 180, now())
    on conflict (user_id) do nothing
    returning user_id into inserted_user;
    if inserted_user is not null then
      insert into public.voicebridge_credit_transactions(
        user_id, amount, currency, transaction_type, reference_type,
        reference_id, idempotency_key, description
      ) values (
        p_user_id, 180, 'CRD', 'grant', 'free_trial', p_user_id::text,
        'free-trial-v2', 'One-time VoiceBridge three-minute trial allowance'
      ) on conflict (user_id, idempotency_key) do nothing;
    end if;

    select * into account_row from public.voicebridge_credit_accounts
      where user_id = p_user_id for update;
    if account_row.available_credits < wallet_charge then
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
