create table if not exists public.voicebridge_live_calls (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'whatsapp')),
  status text not null default 'waiting' check (status in ('waiting', 'ringing', 'active', 'ended', 'failed', 'expired')),
  source_language text,
  invite_token_hash text,
  invite_expires_at timestamptz,
  provider text not null default 'webrtc' check (provider in ('webrtc', 'meta_whatsapp', 'livekit')),
  provider_call_id text,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voicebridge_live_calls_provider_call_unique unique (provider, provider_call_id)
);

create table if not exists public.voicebridge_live_call_participants (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.voicebridge_live_calls(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  participant_type text not null default 'app_user' check (participant_type in ('app_user', 'whatsapp_caller')),
  participant_key_hash text,
  seat smallint not null check (seat in (1, 2)),
  preferred_language text not null,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  constraint voicebridge_live_call_participant_seat_unique unique (call_id, seat),
  constraint voicebridge_live_call_participant_identity_check check (
    (participant_type = 'app_user' and user_id is not null and participant_key_hash is null)
    or (participant_type = 'whatsapp_caller' and user_id is null and participant_key_hash is not null)
  )
);

create unique index if not exists voicebridge_live_call_user_once
  on public.voicebridge_live_call_participants (call_id, user_id)
  where user_id is not null;

create table if not exists public.voicebridge_live_call_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  call_id uuid references public.voicebridge_live_calls(id) on delete set null,
  event_type text not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  constraint voicebridge_live_call_event_unique unique (provider, provider_event_id)
);

create index if not exists voicebridge_live_calls_owner_created_idx
  on public.voicebridge_live_calls (created_by, created_at desc);
create index if not exists voicebridge_live_calls_status_created_idx
  on public.voicebridge_live_calls (status, created_at desc);
create index if not exists voicebridge_live_call_participants_user_idx
  on public.voicebridge_live_call_participants (user_id, created_at desc);

alter table public.voicebridge_live_calls enable row level security;
alter table public.voicebridge_live_call_participants enable row level security;
alter table public.voicebridge_live_call_events enable row level security;

drop policy if exists "Participants can view their live calls" on public.voicebridge_live_calls;
create policy "Participants can view their live calls"
  on public.voicebridge_live_calls for select to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.voicebridge_live_call_participants p
      where p.call_id = id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can view their live call participant rows" on public.voicebridge_live_call_participants;
create policy "Users can view their live call participant rows"
  on public.voicebridge_live_call_participants for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.voicebridge_live_calls c
      where c.id = call_id and c.created_by = (select auth.uid())
    )
  );

revoke all on public.voicebridge_live_calls from anon, authenticated;
revoke all on public.voicebridge_live_call_participants from anon, authenticated;
revoke all on public.voicebridge_live_call_events from anon, authenticated;
grant select on public.voicebridge_live_calls to authenticated;
grant select on public.voicebridge_live_call_participants to authenticated;

comment on table public.voicebridge_live_calls is 'Durable metadata for VoiceBridge in-app and WhatsApp live translation calls. Audio is not stored here.';
comment on table public.voicebridge_live_call_participants is 'Per-call participants and language routing. WhatsApp identities are stored as hashes, not phone numbers.';
comment on table public.voicebridge_live_call_events is 'Idempotency ledger for provider call webhooks; raw webhook payloads are not retained.';
