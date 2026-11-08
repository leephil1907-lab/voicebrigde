# VoiceBridge AI

**Your voice. Every language.**

VoiceBridge AI helps people translate spoken messages while retaining the original speaker's voice and delivery as closely as supported by the voice provider.

## Features

- Record and translate voice messages.
- Preview translated audio before sharing.
- Prepare audio for sharing through the Android system share menu.
- User accounts and private storage.
- Background processing for translation jobs.
- Usage limits: 100 translations per UTC day and 20 per hour.

## Tech Stack

- React, Vite and Expo
- Node.js, Fastify and TypeScript
- Supabase Auth, Postgres and Storage
- ElevenLabs Dubbing
- FFmpeg

## Development

Use Node.js 20 or later.

```bash
npm install
npm run dev:api
npm run dev:web
```

Configure the required environment variables using the example files and deployment documentation.

## Deployment

The project includes a Dockerfile and Render configuration. Set the required service secrets before deployment. Paystack subscriptions require real plan codes created in Paystack and supplied through `PAYSTACK_SUBSCRIPTION_PLANS_JSON` in Render.

## Notes

Voice translation quality depends on the source recording and provider support. Sharing is user-confirmed; VoiceBridge does not automatically send messages through a personal WhatsApp account.

Never commit API keys, access tokens, or private recordings.
