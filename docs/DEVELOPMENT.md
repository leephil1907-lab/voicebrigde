# Development setup

## Prerequisites

- Node.js 22 or newer
- npm
- Expo Go on an Android phone for an early UI preview
- FFmpeg installed for local API development
- Git

## API

From the repository root:

```bash
cd apps/api
npm install
cp ../../.env.example ../../.env
```

Set `ELEVENLABS_API_KEY` in the root `.env` file. Do not put provider credentials in the mobile app.

Start the API:

```bash
npm run dev
```

The API listens on port 8080 by default. Check `GET /health` to confirm that it is running.

## Android mobile app

From the repository root:

```bash
cd apps/mobile
npm install
cp .env.example .env
```

Edit `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL`:

- For a deployed API, use its HTTPS URL.
- For local development with the API running on your computer, use the computer's LAN IP, for example `http://192.168.1.20:8080`.
- Do not use `localhost` or `127.0.0.1` on a physical Android phone; those addresses point to the phone itself.

Start Expo:

```bash
npx expo start --tunnel
```

Scan the QR code with Expo Go and grant microphone access. If the local HTTP API is unreachable, check that the phone and computer are on the same network and that the computer firewall allows port 8080.

## Translation API

- Health: `GET /health`
- Supported languages: `GET /v1/languages`
- Start Dubbing v2 translation: `POST /v1/voice/translate` (multipart: `sourceLanguage=auto`, `targetLanguage`, `file`)
- Poll translation: `GET /v1/voice/translations/:id`
- Preview audio: `GET /v1/voice/previews/:id` (expires after 30 minutes)

The translation route currently allows five starts per IP address per 15 minutes. This is a temporary safeguard; authenticated accounts and per-user quotas are still required before production.

## WhatsApp behavior

Personal WhatsApp uses Android's system share sheet with an OGG/Opus audio file. WhatsApp may show the recording as an audio attachment; the personal-account share flow does not guarantee a native voice-note bubble. The official WhatsApp Business Cloud API adapter is implemented separately, but no public send endpoint is enabled until account authentication, sender authorization, durable send records and webhook tracking are in place.

## Validation

Run the API and mobile type checks:

```bash
cd apps/api && npm install && npm run typecheck && npm run build
cd ../mobile && npm install && npm run typecheck
```

GitHub Actions runs these checks on pushes and pull requests to `main`.

## Production gaps

Translation jobs and preview audio are currently held in process memory. A restart loses active jobs and preview assets. Before production, add persistent job storage, a durable worker queue, private object storage, authenticated accounts, per-user quotas, WhatsApp Business sender authorization and Meta delivery webhooks. End-to-end voice-note presentation must be tested on real Android devices and WhatsApp versions.
