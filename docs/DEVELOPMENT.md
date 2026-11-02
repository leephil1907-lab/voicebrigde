# Development setup

## Prerequisites

- Node.js 20 or newer
- npm
- Expo Go on an Android phone for an early UI preview
- Git

## Mobile app

```bash
cd apps/mobile
npm install
npx expo start
```

Scan the QR code with Expo Go. Microphone recording requires granting the Android microphone permission. A development build may be required for production-native behavior and later integrations.

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

For a physical Android device, use a reachable HTTPS API URL or your development machine's LAN address. Do not use localhost from the phone to reach the computer.

## Environment and secrets

Keep provider credentials on the server. Never put AI keys, Supabase service-role keys, WhatsApp tokens, or Telegram bot tokens in the mobile bundle or commit them to Git.

## Current scope

The foundation build records audio locally and exposes API health/language endpoints. It does not yet upload recordings, call AI providers, clone voices, or send messages. Those capabilities are added in subsequent milestones.
