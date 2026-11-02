# Development setup

## Prerequisites

- Node.js 20 or newer
- npm
- Expo Go on an Android phone for an early UI preview
- Git

## Install dependencies

From the repository root:

```bash
npm install
```

## API

Copy `.env.example` to `.env` at the repository root and set `OPENAI_API_KEY` and `ELEVENLABS_API_KEY`. Keep these keys on the server only.

```bash
npm run dev:api
```

## Mobile app

Set `EXPO_PUBLIC_API_URL` to the reachable API base URL before starting Expo. On a phone where the API is running locally, try `http://127.0.0.1:8080`; when the API is deployed, use its HTTPS URL.

```bash
npm run dev:mobile -- --tunnel
```

Scan the QR code with Expo Go. Grant microphone access. If Android blocks a local HTTP API request, use a reachable HTTPS API URL or a native development build configured for cleartext local development.

## API

```bash
cd apps/api
npm install
cp ../../.env.example ../../.env
npm run dev
```

The API listens on port 8080 by default.

- Health: `GET http://localhost:8080/health`
- Languages: `GET http://localhost:8080/v1/languages`
- Create voice profile: `POST /v1/voice-profiles` (multipart: `name`, `consent=true`, `file`)
- Translate + generate preview: `POST /v1/voice/translate` (multipart: `sourceLanguage`, `targetLanguage`, `voiceId`, `file`)
- Preview audio: `GET /v1/voice/previews/:id` (expires after 30 minutes)

For a physical Android device, use a reachable HTTPS API URL or the device-local API address when the API itself runs on the phone.

## Environment and secrets

Keep provider credentials on the server. Never put AI keys, Supabase service-role keys, WhatsApp tokens, or Telegram bot tokens in the mobile bundle or commit them to Git.

## Current scope

AI transcription, translation, voice enrollment, voice generation, and preview endpoints are wired. Messaging send integrations, user authentication, durable voice-profile storage, private object storage, and production-grade job processing are not implemented yet.
