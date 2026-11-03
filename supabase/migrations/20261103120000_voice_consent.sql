-- Additive migration for projects that already applied the initial durable queue.
-- New translations record when the speaker/permission confirmation was received.
alter table public.voicebridge_jobs
  add column if not exists voice_consented_at timestamptz;

comment on column public.voicebridge_jobs.voice_consented_at is
  'Time the caller confirmed this is their voice or they have permission to translate it. Null for legacy jobs.';
