-- VoiceBridge account-owned voice profiles, consent history, usage metering and billing ledger.
-- All writes are performed by the trusted API/webhook service; clients receive owner-scoped reads only.

create table if not exists public.voicebridge_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  reference_audio_path text,
  provider_voice_id text,
  provider text not null default 'elevenlabs',
  status text not null default 'pending_consent'
    check (status in ('pending_consent', 'active', 'revoked', 'deleted')),
  consent_version text,
  consented_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint voicebridge_profile_consent_check check (
    status <> 'active' or (consented_at is not null and consent_version is not null)
  )
);
create index if not exists voicebridge_voice_profiles_user_idx
  on public.voicebridge_voice_profiles(user_id, created_at desc);

create table if not exists public.voicebridge_voice_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_profile_id uuid not null,
  consent_version text not null,
  consent_scope text not null check (consent_scope in ('own_voice', 'authorized_third_party')),
  speaker_name text,
  consent_text_hash text not null,
  evidence_path text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (voice_profile_id, user_id)
    references public.voicebridge_voice_profiles(id, user_id) on delete cascade
);
create index if not exists voicebridge_voice_consents_owner_idx
  on public.voicebridge_voice_consents(user_id, granted_at desc);

create table if not exists public.voicebridge_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  available_credits bigint not null default 0 check (available_credits >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.voicebridge_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  transaction_type text not null check (transaction_type in ('purchase', 'grant', 'usage', 'refund', 'adjustment')),
  reference_type text,
  reference_id text,
  idempotency_key text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists voicebridge_credit_transactions_owner_idx
  on public.voicebridge_credit_transactions(user_id, created_at desc);

create table if not exists public.voicebridge_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_customer_id text,
  provider_subscription_id text unique,
  plan_code text not null check (plan_code in ('free', 'creator', 'pro', 'business', 'enterprise')),
  status text not null default 'inactive'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'inactive')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  billing_interval text check (billing_interval in ('month', 'year')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists voicebridge_subscriptions_owner_idx
  on public.voicebridge_subscriptions(user_id, created_at desc);
create index if not exists voicebridge_subscriptions_customer_idx
  on public.voicebridge_subscriptions(provider, provider_customer_id);

create table if not exists public.voicebridge_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.voicebridge_jobs(id) on delete set null,
  event_type text not null check (event_type in ('translation_started', 'translation_completed', 'audio_seconds', 'voice_profile_created', 'message_sent')),
  quantity numeric(14,3) not null default 1 check (quantity >= 0),
  unit text not null default 'count',
  plan_code text,
  credits_charged bigint not null default 0 check (credits_charged >= 0),
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists voicebridge_usage_events_owner_idx
  on public.voicebridge_usage_events(user_id, created_at desc);

create table if not exists public.voicebridge_billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  processed_at timestamptz,
  processing_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- RLS is enabled on every public-schema account table. Client reads are owner-scoped.
alter table public.voicebridge_voice_profiles enable row level security;
alter table public.voicebridge_voice_consents enable row level security;
alter table public.voicebridge_credit_accounts enable row level security;
alter table public.voicebridge_credit_transactions enable row level security;
alter table public.voicebridge_subscriptions enable row level security;
alter table public.voicebridge_usage_events enable row level security;
alter table public.voicebridge_billing_events enable row level security;

revoke all on public.voicebridge_voice_profiles, public.voicebridge_voice_consents,
  public.voicebridge_credit_accounts, public.voicebridge_credit_transactions,
  public.voicebridge_subscriptions, public.voicebridge_usage_events,
  public.voicebridge_billing_events from anon, authenticated;
grant select on public.voicebridge_voice_profiles, public.voicebridge_voice_consents,
  public.voicebridge_credit_accounts, public.voicebridge_credit_transactions,
  public.voicebridge_subscriptions, public.voicebridge_usage_events to authenticated;
grant all on public.voicebridge_voice_profiles, public.voicebridge_voice_consents,
  public.voicebridge_credit_accounts, public.voicebridge_credit_transactions,
  public.voicebridge_subscriptions, public.voicebridge_usage_events,
  public.voicebridge_billing_events to service_role;

drop policy if exists "Users can read own voice profiles" on public.voicebridge_voice_profiles;
create policy "Users can read own voice profiles" on public.voicebridge_voice_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can read own voice consents" on public.voicebridge_voice_consents;
create policy "Users can read own voice consents" on public.voicebridge_voice_consents
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can read own credit account" on public.voicebridge_credit_accounts;
create policy "Users can read own credit account" on public.voicebridge_credit_accounts
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can read own credit transactions" on public.voicebridge_credit_transactions;
create policy "Users can read own credit transactions" on public.voicebridge_credit_transactions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can read own subscription" on public.voicebridge_subscriptions;
create policy "Users can read own subscription" on public.voicebridge_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can read own usage events" on public.voicebridge_usage_events;
create policy "Users can read own usage events" on public.voicebridge_usage_events
  for select to authenticated using ((select auth.uid()) = user_id);

-- Billing webhook payloads are server-only; no client policy or table grant is created.
