# Development setup

## Prerequisites

- Node.js 22 or newer
- npm
- Expo Go on an Android phone
- FFmpeg for local worker development
- A Supabase project with Auth, Postgres and Storage enabled
- An ElevenLabs API key with Dubbing v2 access

## 1. Apply the Supabase migration

Apply `supabase/migrations/20261103103000_voicebridge_durable_jobs.sql` to the VoiceBridge Supabase project using its SQL Editor or linked CLI migration workflow. The migration creates the private audio bucket, durable job table, RLS policy and restricted worker-queue RPCs.

Confirm the `public` schema is exposed to the Supabase Data API. The migration grants only the required table privileges and keeps RLS enabled.

## 2. Configure the API and worker

Copy the root environment template into the API workspace so both the API and worker load it when started from `apps/api`:

```bash
cp ../../.env.example .env
```

Set:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_ANON_KEY`)
- `SUPABASE_SECRET_KEY` (preferred) or legacy `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET=voicebridge-private`
- `ELEVENLABS_API_KEY`
- `FFMPEG_PATH=ffmpeg`

The Supabase secret/service-role key is server-only. Never put it in Expo variables or commit it.

Install dependencies and start the API:

```bash
cd apps/api
npm install
npm run dev
```

In a second terminal, start the durable worker:

```bash
cd apps/api
npm run dev:worker
```

The API listens on port 8080. The worker has no HTTP listener. Check `GET /health` for API readiness.

## 3. Configure Android

Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Install and launch:

```bash
cd apps/mobile
npm install
npx expo start --tunnel
```

Use the deployed HTTPS API URL or your development computer's LAN IP. Do not use `localhost` or `127.0.0.1` on a physical Android phone.

The app provides email/password sign-up and sign-in. If Supabase email confirmation is enabled, confirm the new account from the email before signing in.

## 4. Deploy on Railway

Deploy two services from `apps/api/Dockerfile` and the same repository commit:

| Service | Start command |
|---|---|
| VoiceBridge API | `node dist/server.js` |
| VoiceBridge worker | `npm run worker` |

Set the server-side Supabase and ElevenLabs variables on both services. Attach the public domain only to the API service. The worker does not expose a port.

## API endpoints

- `GET /health` — public health check.
- `GET /v1/languages` — public supported-language list.
- `POST /v1/voice/translate` — authenticated multipart upload; returns HTTP 202 after source audio is stored and the job is queued.
- `GET /v1/voice/translations/:id` — authenticated status and signed audio URL; only the owning user can retrieve it.
- `GET /v1/voice/translations` — authenticated latest 50 jobs for the current user.

Protected routes require `Authorization: Bearer <Supabase access token>`.

## Queue and recovery behavior

Postgres stores job state and provider IDs. The worker claims jobs atomically using `FOR UPDATE SKIP LOCKED`, refreshes a two-minute lease every 30 seconds, and retries failures up to four attempts with backoff. A new worker process can reclaim a job after the old worker's lease expires and resume from persisted provider IDs.

The private Storage bucket stores source and translated audio under `{user_id}/{job_id}/`. The API creates a 30-minute signed output URL only after verifying job ownership.

## Validation

```bash
cd apps/api
npm install
npm run typecheck
npm run build
npm run dev:worker
```

In another terminal:

```bash
cd apps/mobile
npm install
npm run typecheck
```

GitHub Actions runs API and mobile TypeScript checks on pushes and pull requests to `main`.

## Remaining production work

- Apply and verify the migration on the selected Supabase project.
- Configure Railway API and worker services and all secrets.
- Add account deletion, recording retention and scheduled object cleanup.
- Add billing-aware per-user quotas.
- Finish WhatsApp Business sender authorization, persisted send jobs and Meta delivery webhooks.
- Run real provider, API restart, worker crash/recovery, cross-user isolation and Android device tests.
