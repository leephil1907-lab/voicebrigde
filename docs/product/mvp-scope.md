# MVP scope

## Included in foundation

- Android-first Expo application shell
- Local microphone recording and stop action
- Target-language selection
- Fastify API with health and language endpoints
- Repository structure and development documentation

## Next milestone

- Supabase authentication and user profiles
- Secure signed audio upload
- Speech-to-text provider adapter
- Translation provider adapter
- Editable transcript and translated text review
- Translation job status and error handling

## Following milestone

- Voice enrollment and provider consent
- Multilingual voice generation
- Audio preview and normalized OGG/Opus output
- Usage and cost tracking

## Messaging milestone

- Telegram Bot API sendVoice integration
- WhatsApp Business Platform integration after business account onboarding
- Personal WhatsApp share hand-off with clear labeling
- Per-platform capability tests and delivery receipts

## Acceptance criteria for native voice notes

A feature is complete only when a real recipient sees the expected in-chat voice-message UI and can play the message. A share-sheet attachment or generic audio bubble does not satisfy this acceptance criterion unless the platform itself renders it as a native voice note.
