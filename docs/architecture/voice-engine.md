# Voice translation engine

## Live pipeline

1. The Android app records a source message with Expo Audio.
2. The app uploads the recording as multipart form data to `POST /v1/voice/translate`.
3. The API transcribes the audio with OpenAI Audio Transcriptions.
4. The API translates the transcript with an OpenAI chat completion constrained to return only the translated text.
5. The API generates speech with the exact enrolled ElevenLabs voice ID using the multilingual model and identity-focused voice settings.
6. The API returns transcript, translated text and a short-lived preview URL. The app plays the preview with Expo Audio.

## Voice profile enrollment

`POST /v1/voice-profiles` accepts multipart fields `name`, `consent=true` and one audio file. The server creates a voice through ElevenLabs Instant Voice Cloning and returns the provider voice ID. The app only submits a voice sample after the user confirms ownership or explicit permission.

## Configuration

Set `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` in the API host environment. Never place either key in the mobile app. Voice generation always uses the enrolled `voiceId`; it does not select a stock voice. Defaults prioritize identity with `ELEVENLABS_SIMILARITY_BOOST=0.9`, `ELEVENLABS_SPEAKER_BOOST=true`, `ELEVENLABS_STYLE=0`, and `ELEVENLABS_STABILITY=0.55`. These settings are configurable from 0 to 1. Similarity boost and speaker boost favor resemblance; zero style exaggeration avoids adding an artificial performance style; stability balances consistent delivery with natural variation. The correct balance can vary by reference recording. ElevenLabs account access, plan limits, voice-cloning eligibility and language quality vary by account and voice.

## Reference recording quality

For Instant Voice Cloning, capture about 1–2 minutes of clear, continuous speech from one speaker. Use a quiet room, keep the microphone distance consistent, avoid music and competing voices, and speak in the natural tone and cadence you want the clone to retain. The mobile flow uses the enrollment recording only to create the voice profile; record a separate message after enrollment so the reference sample is not accidentally treated as the message to translate. A clone preserves recognizable vocal characteristics, not the exact acoustics of the original recording. When generating another language, pronunciation and accent can vary with the language and model.

## Current storage limitation

Generated preview bytes are held in API process memory for 30 minutes. Previews disappear on process restart and are not durable across multiple API instances. Production deployment must move audio to private object storage with signed, expiring URLs, and persist voice profiles against authenticated user accounts. The current mobile app keeps the selected voice ID in screen state; it must be persisted securely after authentication is implemented.

## Operational safeguards

- Audio upload limit defaults to 20 MiB.
- API rate limiting applies to generation endpoints.
- Provider credentials stay server-side.
- Voice enrollment requires explicit consent.
- Translated text is returned for review before the messaging/send milestone.
- Sending is not triggered by generation; preview is a separate step.
