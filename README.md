# VoiceBridge AI

**Your voice. Every language.**

VoiceBridge AI is an Android-first multilingual voice messaging application. Users record a message in their own language, review a translation, generate speech using an authorized personal voice profile, and send it through supported messaging integrations.

## Product principles

- Preserve the speaker's recognizable voice where the selected voice provider and target language support it.
- Always show the translated text and provide an audio preview before sending.
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

The first live AI integration is now implemented in the API and Android UI:

1. Record an audio sample or message on Android.
2. Enroll an authorized voice sample through ElevenLabs Instant Voice Cloning.
3. Upload a message recording to the Fastify API.
4. Transcribe it with OpenAI Audio Transcriptions.
5. Translate the transcript with OpenAI.
6. Generate speech with the exact enrolled ElevenLabs voice ID using identity-focused similarity settings (high similarity, speaker boost on, style exaggeration off).
7. Review the transcript and translated text, then play the generated audio preview.

Configure `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` on the API server. The synthesis defaults prioritize the cloned reference voice rather than a generic voice: similarity boost 0.9, speaker boost on, style 0, and stability 0.55. Use a clean 1–2 minute single-speaker enrollment sample, then record a separate message to translate. See [the voice engine guide](docs/architecture/voice-engine.md). This integration has not yet been validated on a physical device with live provider credentials. Preview audio and voice profile IDs are currently held in process memory / app screen state; durable storage and authenticated accounts are the next production-hardening steps.

## Planned message pipeline

1. Record audio on the Android device.
2. Upload it using a short-lived signed upload URL.
3. Transcribe the source audio.
4. Translate the transcript into the recipient's selected language.
5. Let the user review and edit the translation.
6. Generate speech using a voice profile the user is authorized to use.
7. Normalize the audio to a provider-compatible voice-message format.
8. Preview the result and require explicit approval.
9. Send through a platform adapter and track the provider's response.

## WhatsApp-first delivery

Both WhatsApp paths are now represented in the implementation:

- **Personal WhatsApp:** the translated preview can be downloaded to the Android cache and shared through the native system sharesheet. The user selects WhatsApp, chooses the chat, and confirms sending. This is a file hand-off and may appear as an audio attachment rather than a microphone-style voice-note bubble; verify on real devices.
- **WhatsApp Business:** `apps/api/src/messaging/whatsapp-business.ts` contains a server-side Cloud API adapter that uploads OGG/Opus audio and sends it as a voice-marked audio message. It is intentionally not exposed through an HTTP send route until VoiceBridge has authenticated users, business-account authorization, persistent send jobs, and webhook delivery tracking.

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

The mobile recorder, API, OpenAI transcription/translation, ElevenLabs voice enrollment/generation, and audio preview flow are implemented in the repository. Live use requires provider credentials and end-to-end testing. Production storage, account authentication, editing controls, and messaging delivery integrations remain outstanding.

## Local development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup instructions and [docs/architecture/overview.md](docs/architecture/overview.md) for system design.

## Security

Never commit real API keys, access tokens, voice samples, personal recordings, Supabase service-role keys, or WhatsApp credentials. Use environment variables and a secret manager.