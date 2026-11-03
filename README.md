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
infra/
  supabase/           Database migrations and local configuration
  docker/             Local development services
docs/
  architecture/       Architecture decisions and integration notes
  product/            Product requirements and UX flows
```

## AI voice translation pipeline

The primary voice engine now uses asynchronous ElevenLabs Dubbing v2 rather than the previous chained transcription → text translation → generic cloned TTS path:

1. Record a message on Android.
2. Upload the recording to the Fastify API; source-language detection is automatic unless a source language is explicitly supplied.
3. Create an ElevenLabs Dubbing v2 project and queue the target language with cloning strength 8/10.
4. Poll the asynchronous job until dubbing completes; the model uses the speaker in the source recording as the voice reference and aims to preserve identity, emotion, timing and tone.
5. Convert the WAV result to mono OGG/Opus with FFmpeg for WhatsApp-compatible voice-note delivery.
6. Retrieve the source and translated segment transcripts when available.\n7. Preview the translated audio before choosing a delivery channel.

Configure `ELEVENLABS_API_KEY` and ensure FFmpeg is installed (the API Dockerfile installs it). Dubbing v2 supports 90+ languages and is designed to preserve speaker identity, emotional tone and timing, but results still require listening tests; cloning strength 8 favors resemblance and may affect naturalness across very different languages. See [the voice engine guide](docs/architecture/voice-engine.md). Jobs and preview audio are currently held in process memory and expire after 30 minutes; a durable queue, object storage and authenticated accounts remain required before production. The translation endpoint is limited to five starts per IP per 15 minutes as a temporary abuse-control measure, not a replacement for account authentication.

## WhatsApp-first delivery

Both WhatsApp paths are now represented in the implementation:

- **Personal WhatsApp:** the translated preview can be downloaded to the Android cache and shared through the native system sharesheet. The user selects WhatsApp, chooses the chat, and confirms sending. VoiceBridge shares mono OGG/Opus audio, but the personal-account share interface does not guarantee WhatsApp's native microphone-recorded voice-note bubble.
- **WhatsApp Business:** `apps/api/src/messaging/whatsapp-business.ts` contains a server-side Cloud API adapter that uploads OGG/Opus audio and sends it with `audio.voice: true` so WhatsApp can render it as a native voice message from the registered Business number. It is intentionally not exposed through an HTTP send route until VoiceBridge has authenticated users, business-account authorization, persistent send jobs, and webhook delivery tracking.

See [the WhatsApp integration architecture](docs/architecture/whatsapp-integration.md) for provider setup and production acceptance tests. Personal sharing requires the Expo FileSystem and Sharing modules. Business sending requires an eligible Meta Business Platform account, server-side credentials, an authorized recipient, and audio-worker conversion to OGG/Opus.

## Technology baseline

- Mobile: Expo + React Native + TypeScript
- API: Node.js + Fastify + TypeScript
- Database and authentication: Supabase
- Background processing: Redis + BullMQ (introduced when async jobs are enabled)
- Audio processing: FFmpeg in a server-side worker
- Speech, translation and voice generation: provider adapters; credentials remain server-side
- Deployment: Railway-compatible API and worker services

## Development status

The mobile recorder, asynchronous ElevenLabs Dubbing v2 job flow, source/translated transcript retrieval, OGG/Opus conversion, audio preview, and initial WhatsApp delivery adapters are implemented in the repository. Live use requires provider credentials and end-to-end testing. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to the deployed API URL or your development computer's LAN IP; `localhost` on a physical Android phone points to the phone itself. Production storage, account authentication, editing controls, and messaging delivery integrations remain outstanding.

## Local development

Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set the API URL before launching Expo. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup instructions and [docs/architecture/overview.md](docs/architecture/overview.md) for system design.

## Security

Never commit real API keys, access tokens, voice samples, personal recordings, Supabase service-role keys, or WhatsApp credentials. Use environment variables and a secret manager.