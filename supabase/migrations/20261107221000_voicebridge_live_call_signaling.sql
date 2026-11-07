alter table public.voicebridge_live_call_participants
  add column if not exists spoken_language text not null default 'en';

drop policy if exists "VoiceBridge call participants can receive call signals" on realtime.messages;
create policy "VoiceBridge call participants can receive call signals"
  on realtime.messages for select to authenticated
  using (
    exists (
      select 1 from public.voicebridge_live_call_participants p
      where p.user_id = (select auth.uid())
        and p.left_at is null
        and p.call_id::text = split_part(realtime.topic(), ':', 3)
    )
  );

drop policy if exists "VoiceBridge call participants can send call signals" on realtime.messages;
create policy "VoiceBridge call participants can send call signals"
  on realtime.messages for insert to authenticated
  with check (
    exists (
      select 1 from public.voicebridge_live_call_participants p
      where p.user_id = (select auth.uid())
        and p.left_at is null
        and p.call_id::text = split_part(realtime.topic(), ':', 3)
    )
  );

comment on column public.voicebridge_live_call_participants.spoken_language is 'Language this participant speaks; the other participant hears translated audio in this language.';
