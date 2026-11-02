# Voice translation engine

## Live pipeline

1. The Android app records a source message with Expo Audio.
2. The app uploads the recording as multipart form data to `POST /v1/voice/translate`.
3. The API transcribes the audio with OpenAI Audio Transcriptions.
4. The API translates the transcript with an OpenAI chat completion constrained to return only the translated text.
5. The API generates speech with the selected ElevenLabs voice ID using the multilingual model.
6. The API returns transcript, translated text and a short-lived preview URL. The app plays the preview with Expo Audio.

## Voice profile enrollment

`POST /v1/voice-profiles` accepts multipart fields `name`, `consent=true` and one audio file. The server creates a voice through ElevenLabs Instant Voice Cloning and returns the provider voice ID. The app only submits a voice sample after the user confirms ownership or explicit permission.

## Configuration

Set `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` in the API host environment. Never place either key in the mobile app. ElevenLabs account access, plan limits, voice-cloning eligibility and language quality vary by account and voice.

## Current storage limitation

Generated preview bytes are held in API process memory for 30 minutes. Previews disappear on process restart and are not durable across multiple API instances. Production deployment must move audio to private object storage with signed, expiring URLs, and persist voice profiles against authenticated user accounts. The current mobile app keeps the selected voice ID in screen state; it must be persisted securely after authentication is implemented.

## Operational safeguards

- Audio upload limit defaults to 20 MiB.
- API rate limiting applies to generation endpoints.
- Provider credentials stay server-side.
- Voice enrollment requires explicit consent.
- Translated text is returned for review before the messaging/send milestone.
- Sending is not triggered by generation; preview is a separate step.
