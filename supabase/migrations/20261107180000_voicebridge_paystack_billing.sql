-- Paystack billing ledger for NGN credit top-ups and recurring plan subscriptions.
-- All payment writes and credit grants are server/webhook-only.
create table if not exists public.voicebridge_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'paystack' check (provider = 'paystack'),
  reference text not null unique,
  payment_type text not null check (payment_type in ('credit_topup', 'subscription')),
  product_code text not null,
  plan_code text check (plan_code in ('creator', 'pro', 'business', 'enterprise')),
  paystack_plan_code text,
  billing_interval text check (billing_interval in ('month', 'year')),
  billing_email text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  credits_granted bigint not null default 0 check (credits_granted >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'success', 'failed', 'reversed', 'refunded')),
  provider_transaction_id text,
  provider_customer_code text,
  gateway_payload jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists voicebridge_payments_owner_idx
  on public.voicebridge_payments(user_id, created_at desc);
create index if not exists voicebridge_payments_subscription_lookup_idx
  on public.voicebridge_payments(billing_email, paystack_plan_code, created_at desc)
  where payment_type = 'subscription';

alter table public.voicebridge_payments enable row level security;
revoke all on public.voicebridge_payments from anon, authenticated;
grant select on public.voicebridge_payments to authenticated;
grant all on public.voicebridge_payments to service_role;
drop policy if exists "Users can read own payments" on public.voicebridge_payments;
create policy "Users can read own payments" on public.voicebridge_payments
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.fulfill_voicebridge_paystack_payment(
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_provider_transaction_id text,
  p_gateway_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.voicebridge_payments;
begin
  select * into payment_row
  from public.voicebridge_payments
  where reference = p_reference
  for update;

  if not found then
    raise exception 'Payment reference not found';
  end if;
  if payment_row.amount_minor <> p_amount_minor or payment_row.currency <> p_currency then
    raise exception 'Verified payment amount or currency does not match the pending order';
  end if;
  if payment_row.status = 'success' then
    return jsonb_build_object('processed', false, 'alreadyProcessed', true, 'paymentId', payment_row.id);
  end if;
  if payment_row.status <> 'pending' then
    raise exception 'Payment is not pending';
  end if;

  update public.voicebridge_payments
  set status = 'success',
      provider_transaction_id = p_provider_transaction_id,
      gateway_payload = coalesce(p_gateway_payload, '{}'::jsonb),
      paid_at = now(),
      updated_at = now()
  where id = payment_row.id;

  if payment_row.payment_type = 'credit_topup' and payment_row.credits_granted > 0 then
    insert into public.voicebridge_credit_accounts(user_id, currency, available_credits, updated_at)
    values (payment_row.user_id, 'CRD', payment_row.credits_granted, now())
    on conflict (user_id) do update
      set available_credits = public.voicebridge_credit_accounts.available_credits + excluded.available_credits,
          updated_at = now();

    insert into public.voicebridge_credit_transactions(
      user_id, amount, currency, transaction_type, reference_type,
      reference_id, idempotency_key, description
    ) values (
      payment_row.user_id, payment_row.credits_granted, 'CRD', 'purchase',
      'paystack', payment_row.reference, 'paystack:' || payment_row.reference,
      'VoiceBridge credit purchase'
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object('processed', true, 'alreadyProcessed', false, 'paymentId', payment_row.id);
end;
$$;
revoke all on function public.fulfill_voicebridge_paystack_payment(text,bigint,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.fulfill_voicebridge_paystack_payment(text,bigint,text,text,jsonb) to service_role;
