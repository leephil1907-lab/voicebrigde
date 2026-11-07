-- Cover the new foreign keys used by owner and usage lookups.
create index if not exists voicebridge_usage_events_job_idx
  on public.voicebridge_usage_events(job_id)
  where job_id is not null;

create index if not exists voicebridge_voice_consents_profile_owner_idx
  on public.voicebridge_voice_consents(voice_profile_id, user_id);
