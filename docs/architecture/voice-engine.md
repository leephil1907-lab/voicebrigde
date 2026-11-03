# Voice translation engine

## Active translation pipeline

1. The Android app records a source message with Expo Audio.
2. The app uploads the recording as multipart form data to `POST /v1/voice/translate`.
3. The API creates an ElevenLabs Dubbing v2 project. Source-language detection is automatic when `sourceLanguage=auto` or the field is omitted.
4. The API waits for source preparation, then creates a target language with `voice_settings.cloning_strength=8`.
5. The API polls the language target until it completes, downloads the lossless WAV, and converts it to mono OGG/Opus with FFmpeg.
6. The API retrieves the source and translated segment transcripts when available, then returns a completed job with a short-lived preview URL.
7. The Android app displays the transcripts, plays the preview, and lets the user share the translated audio.

Dubbing v2 is an audio-to-audio dubbing model designed to retain speaker identity, emotional tone and timing. It does not guarantee perfect preservation in every language or recording. A cloning strength of 8 favors resemblance and may reduce naturalness for languages with very different phonetics. The user must listen to the preview before sending.

## API job lifecycle

- `POST /v1/voice/translate` returns HTTP 202 with a job ID.
- `GET /v1/voice/translations/:id` returns `queued`, `preparing`, `processing`, `completed`, or `failed`.
- Completed jobs include source/translated transcript text and `audioUrl`.
- Preview audio is served by `GET /v1/voice/previews/:id`.

Jobs and audio previews are currently held in process memory. They disappear when the API restarts and do not work reliably across multiple API instances. This is a development implementation, not production-grade job storage. Before launch, move job state to a persistent database, audio to private object storage, and processing to a durable worker queue with retry/recovery semantics.

## Voice profile enrollment

`POST /v1/voice-profiles` remains available as an optional legacy feature for explicit voice-profile enrollment. It is not required by the Dubbing v2 translation flow: Dubbing v2 uses the speaker in each source recording as its voice reference.

## Configuration

Set `ELEVENLABS_API_KEY` in the API host environment. Never place provider credentials in the mobile app. The API Dockerfile installs FFmpeg; local development environments must install FFmpeg separately or set `FFMPEG_PATH`.

For the Android app, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to the deployed HTTPS API URL or the development computer's LAN IP. Do not use `localhost` or `127.0.0.1` on a physical Android phone.

## WhatsApp audio output

The downloaded WAV is converted to mono OGG/Opus (libopus, 24 kbps, 48 kHz). This format is suitable for WhatsApp voice-message APIs. The WhatsApp Business adapter validates the OGG/Opus MIME type and sets `audio.voice=true` on its outgoing Cloud API message.

Personal WhatsApp is different: the Android sharesheet hands the OGG file to WhatsApp, but the public personal-account share interface does not guarantee a native push-to-talk voice-note bubble. It may appear as an audio attachment. A native voice-message send is supported by the official Business Cloud API from a registered Business number, not from the user's personal WhatsApp identity.

## Operational safeguards

- Audio upload limit defaults to 20 MiB.
- Translation starts are limited to five per IP address per 15 minutes as a temporary abuse-control measure.
- Provider credentials stay server-side.
- Voice-profile enrollment requires explicit consent.
- The user previews the generated audio before sharing.
- Do not expose WhatsApp Business sending until user authentication, business sender authorization, persistent send jobs, idempotency, and Meta webhook delivery tracking are implemented.
