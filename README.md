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

## Messaging support

| Platform | Initial delivery strategy | Native voice-note status |
| --- | --- | --- |
| WhatsApp personal | Android share/hand-off flow; investigate supported on-device options | Must be verified on real devices; no unofficial account automation |
| WhatsApp Business | Official WhatsApp Business Platform adapter | Supported voice-message API flow, subject to account eligibility and policy |
| Telegram | Bot API `sendVoice` adapter | Native voice message |
| Other messengers | Adapter interface and Android share fallback | Per-platform verification required |

A share-sheet hand-off may create an audio attachment rather than a microphone-recorded voice-note bubble. The app must label this honestly and must not claim native voice-note delivery unless the receiving platform confirms the supported message type.

## Technology baseline

- Mobile: Expo + React Native + TypeScript
- API: Node.js + Fastify + TypeScript
- Database and authentication: Supabase
- Background processing: Redis + BullMQ (introduced when async jobs are enabled)
- Audio processing: FFmpeg in a server-side worker
- Speech, translation and voice generation: provider adapters; credentials remain server-side
- Deployment: Railway-compatible API and worker services

## Development status

This repository is being initialized. The first milestone is a runnable mobile/API foundation with explicit provider interfaces and safe messaging boundaries. Live AI generation and production messaging require provider credentials and platform onboarding.

## Local development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup instructions and [docs/architecture/overview.md](docs/architecture/overview.md) for system design.

## Security

Never commit real API keys, access tokens, voice samples, personal recordings, Supabase service-role keys, or WhatsApp credentials. Use environment variables and a secret manager.