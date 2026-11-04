-- Private encrypted linked-device credential records. Nothing here enables a
-- connection or a send; only the API service role can use these records.
create table if not exists public.voicebridge_whatsapp_session_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_name text not null check (char_length(record_name) between 1 and 1024),
  encrypted_value text not null check (char_length(encrypted_value) <= 1048576),
  updated_at timestamptz not null default now(),
  primary key (owner_id, record_name)
);
alter table public.voicebridge_whatsapp_session_records enable row level security;
revoke all on table public.voicebridge_whatsapp_session_records from public, anon, authenticated;
grant select, insert, update, delete on table public.voicebridge_whatsapp_session_records to service_role;

-- Apply a Signal key update as one database transaction. The API must verify the
-- authenticated owner before invoking this service-role-only function.
create or replace function public.voicebridge_whatsapp_session_write(p_owner uuid, p_values jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare k text; v jsonb;
begin
  if p_owner is null or jsonb_typeof(p_values) <> 'object' then raise exception 'invalid session update'; end if;
  for k, v in select * from jsonb_each(p_values) loop
    if v = 'null'::jsonb then
      delete from public.voicebridge_whatsapp_session_records where owner_id = p_owner and record_name = k;
    elsif jsonb_typeof(v) = 'string' then
      insert into public.voicebridge_whatsapp_session_records (owner_id, record_name, encrypted_value)
        values (p_owner, k, v #>> '{}')
        on conflict (owner_id, record_name) do update set encrypted_value = excluded.encrypted_value, updated_at = now();
    else
      raise exception 'invalid encrypted session value';
    end if;
  end loop;
end $$;
revoke all on function public.voicebridge_whatsapp_session_write(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.voicebridge_whatsapp_session_write(uuid, jsonb) to service_role;

-- Durable idempotency: an attempt is reserved before upload or relay. A pending
-- attempt is never automatically replayed, including after a server restart.
create table if not exists public.voicebridge_whatsapp_send_attempts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null,
  job_id uuid not null,
  recipient_hash text not null,
  state text not null check (state in ('reserved','accepted','unknown')),
  message_id text,
  created_at timestamptz not null default now(),
  primary key (owner_id, attempt_id)
);
alter table public.voicebridge_whatsapp_send_attempts enable row level security;
revoke all on table public.voicebridge_whatsapp_send_attempts from public, anon, authenticated;
grant select,insert,update on table public.voicebridge_whatsapp_send_attempts to service_role;
