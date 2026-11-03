# Voice translation engine

## Active translation pipeline

1. The Android app records a source message with Expo Audio.
2. The signed-in app uploads the recording as multipart form data to `POST /v1/voice/translate` with its Supabase access token.
3. The API verifies the token, stores the source recording in the private `voicebridge-private` bucket, and inserts an owned job into Postgres.
4. A separate worker claims the job from the durable Postgres queue, creates or resumes an ElevenLabs Dubbing v2 project, and queues the target language with cloning strength 8.
5. The worker downloads the completed WAV, converts it to mono OGG/Opus with FFmpeg, and stores the output in the user's private storage folder.
6. The worker persists source/translated segment transcripts and marks the job complete.
7. The app polls the authenticated job endpoint, displays transcripts, and receives a 30-minute signed URL for preview and sharing.

Dubbing v2 is designed to retain speaker identity, emotional tone and timing. It does not guarantee perfect preservation in every language or recording. A cloning strength of 8 favors resemblance and may reduce naturalness for languages with very different phonetics. The user must listen to the preview before sending.

## Durable job lifecycle

- `POST /v1/voice/translate` returns HTTP 202 after the source object and job row have been stored.
- `GET /v1/voice/translations/:id` returns `queued`, `processing`, `completed`, or `failed`, and only returns data when the job belongs to the authenticated user.
- `GET /v1/voice/translations` returns the authenticated user's latest 50 jobs.
- The worker claims jobs with `FOR UPDATE SKIP LOCKED`, holds a two-minute lease, and refreshes the lease every 30 seconds.
- Provider project and target-language IDs are saved so a restarted worker can resume the existing provider job.
- Failed jobs are retried with backoff up to four attempts. Expired final-attempt leases are marked failed.
- Postgres is the queue; Redis/BullMQ is not required for this deployment.

## Authentication and isolation

Supabase Auth email/password sessions are persisted on Android with AsyncStorage. The API verifies the current access token with Supabase Auth before accepting or reading a job. Every job row has a `user_id` foreign key to `auth.users`; API reads filter by both job ID and the authenticated user ID. RLS allows authenticated users to select only their own rows. The service-role/secret key is used only by the API and worker.

Source and output audio are stored under `{user_id}/{job_id}/` in a private bucket. The API generates a short-lived signed output URL only after checking ownership. The mobile app receives only the publishable key and signed URL; it never receives the service-role/secret key.

## Voice profile enrollment

The current Dubbing v2 flow uses the speaker in each source recording as its voice reference. Separate voice profile enrollment is not required by the active mobile flow.

## Configuration

API and worker: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_ANON_KEY`), `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`), `SUPABASE_STORAGE_BUCKET=voicebridge-private`, `ELEVENLABS_API_KEY`, and `FFMPEG_PATH`.

Mobile: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

The API Dockerfile installs FFmpeg. Local worker development requires FFmpeg on the host.

## WhatsApp audio output

The translated WAV is converted to mono OGG/Opus (libopus, 24 kbps, 48 kHz). The WhatsApp Business adapter validates the OGG/Opus MIME type and sets `audio.voice=true` on its outgoing Cloud API message.

Personal WhatsApp uses Android's system sharesheet. The public personal-account share interface does not guarantee a native push-to-talk voice-note bubble; it may appear as an audio attachment. The official Business Cloud API can send a voice-marked audio message from a registered Business number.

## Operational safeguards and remaining work

- Audio upload limit defaults to 20 MiB.
- Translation starts are limited to five per IP per 15 minutes and 20 per user per hour.
- Provider credentials stay server-side.
- The private audio bucket and per-user ownership checks isolate recordings.
- Account deletion, scheduled audio cleanup and retention periods still need a product decision.
- WhatsApp Business send endpoints remain disabled until business sender authorization, persisted send jobs and Meta delivery webhooks are implemented.
- Run cross-user access tests, API restart tests, worker crash/recovery tests, and real Android WhatsApp tests before production launch.
