# VoiceBridge AI

**Your voice. Every language.**

VoiceBridge AI is an Android-first multilingual voice messaging application. Users record a message in their own language, translate it while retaining the original speaker's vocal identity and delivery as closely as possible, preview it, and send it through supported messaging integrations.

## Product principles

- Preserve the speaker's recognizable voice where the selected voice provider and target language support it.
- Show the provider's source and translated transcripts when available, and provide an audio preview before sending.
- Send native voice messages only through documented, supported platform APIs.
- Keep personal WhatsApp and WhatsApp Business delivery paths distinct.
- Never automate or scrape personal messaging accounts through unofficial interfaces.
- Protect voice recordings, voice profiles, provider credentials, and messaging tokens.

## Repository layout

```
apps/
  mobile/             Expo React Native Android application
  api/                Fastify + TypeScript API
packages/
  contracts/          Shared API and domain contracts
  config/             Shared TypeScript and lint configuration
supabase/
  migrations/         Database schema, RLS policies and durable queue
docs/
  architecture/       Architecture decisions and integration notes
  product/            Product requirements and UX flows
```

## AI voice translation pipeline

The primary voice engine now uses asynchronous ElevenLabs Dubbing v2 rather than the previous chained transcription → text translation → generic cloned TTS path:

1. Record a message on Android.
2. Upload the recording to the Fastify API; source-language detection is automatic unless a source language is explicitly supplied.
3. Create an ElevenLabs Dubbing v2 project, wait for source preparation, then queue the target language with cloning strength 8/10.
4. Poll the asynchronous job until dubbing completes; the model uses the speaker in the source recording as the voice reference and aims to preserve identity, emotion, timing and tone.
5. Convert the WAV result to mono OGG/Opus with FFmpeg for WhatsApp-compatible voice-note delivery.
6. Retrieve the source and translated segment transcripts when available.
7. Preview the translated audio before choosing a delivery channel.

Configure `ELEVENLABS_API_KEY` and ensure FFmpeg is installed (the API Dockerfile installs it). Dubbing v2 is designed to preserve speaker identity, emotional tone and timing, but results still require listening tests. See [the voice engine guide](docs/architecture/voice-engine.md).

## WhatsApp-first delivery

Both WhatsApp paths are now represented in the implementation:

- **Personal WhatsApp:** the translated preview can be downloaded to the Android cache and shared through the native system sharesheet. The user selects WhatsApp, chooses the chat, and confirms sending. VoiceBridge shares mono OGG/Opus audio, but the personal-account share interface does not guarantee WhatsApp's native microphone-recorded voice-note bubble.
- **WhatsApp Business:** `apps/api/src/messaging/whatsapp-business.ts` contains a server-side Cloud API adapter that uploads OGG/Opus audio and sends it with `audio.voice: true` so WhatsApp can render it as a native voice message from the registered Business number. It is intentionally not exposed through an HTTP send route until VoiceBridge has authenticated users, business-account authorization, persistent send jobs, and webhook delivery tracking.

See [the WhatsApp integration architecture](docs/architecture/whatsapp-integration.md) for provider setup and production acceptance tests. Personal sharing requires the Expo FileSystem and Sharing modules. Business sending requires an eligible Meta Business Platform account, server-side credentials, an authorized recipient, and audio-worker conversion to OGG/Opus.

## Durable jobs and authentication

- Supabase Auth provides email/password accounts and persistent mobile sessions.
- The API verifies each access token with Supabase Auth before accepting or reading a translation.
- Source recordings and translated OGG/Opus outputs live in a private Supabase Storage bucket, under a user-specific path.
- `voicebridge_jobs` stores each job, provider project/language IDs, transcripts, retry state and output path in Postgres.
- The separate `dubbing-worker` process claims jobs atomically with `FOR UPDATE SKIP LOCKED`, heartbeats its lease, resumes provider work after restarts, and retries failed attempts with backoff.
- The queue uses Postgres directly; Redis and BullMQ are not required for this first durable-worker implementation.

Run the API and worker as two services from `apps/api/Dockerfile`: the API starts with `node dist/server.js`; the worker service runs `npm run worker`.

## Technology baseline

- Mobile: Expo + React Native + TypeScript + Supabase Auth
- API: Node.js + Fastify + TypeScript
- Database and authentication: Supabase Postgres + Auth + private Storage
- Background processing: Postgres queue with atomic worker leases
- Audio processing: FFmpeg in a separate server-side worker
- Speech, translation and voice generation: provider adapters; credentials remain server-side
- Deployment: Railway-compatible API and worker services

## Development status

The repository now includes Supabase email/password sign-in, API bearer-token verification, per-user job ownership, a private audio bucket, a durable Postgres queue, and a separate restart-recoverable Dubbing v2 worker. These components require the migration to be applied to the intended Supabase project and the API/worker/mobile environment variables to be configured before live use. End-to-end provider and device testing is still required.

## Local development

Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set the API URL, Supabase project URL and publishable key. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for migration, API, worker and mobile setup instructions.

## Security

Never commit real API keys, access tokens, voice samples, personal recordings, Supabase service-role keys, or WhatsApp credentials. Use environment variables and a secret manager.