# VoiceBridge AI architecture

## Design goals

1. Android-first, voice-first experience.
2. Provider-independent speech, translation, and voice generation.
3. Explicit user approval before external message delivery.
4. Messaging adapters with platform-specific capabilities.
5. Private audio and credential handling.

## Processing flow

Mobile recorder -> authenticated API -> private upload -> transcription adapter -> translation adapter -> user review -> voice generation adapter -> audio normalization worker -> preview -> messaging adapter -> delivery status.

Long-running work belongs in background jobs. The API should return job identifiers and expose status rather than holding a mobile request open while models process audio.

## Provider boundaries

Define interfaces for:
- SpeechToTextProvider
- TranslationProvider
- VoiceGenerationProvider
- AudioStorage
- MessagingAdapter

Each provider adapter reports supported languages, input/output formats, duration limits, cost metadata where available, and typed failures.

## WhatsApp constraints

The official WhatsApp Business Platform is designed around business messaging, not arbitrary control of a personal WhatsApp account. Business API voice messages and personal-account hand-off are separate delivery paths. The personal path must not use unofficial WhatsApp Web automation, private APIs, scraping, or credential collection.

## Voice identity and consent

Voice enrollment must be explicit. Users may only clone their own voice or a voice for which they have documented authorization. Provide deletion controls and avoid retaining enrollment audio after the provider's required processing period.

## Audio contract

The messaging layer accepts normalized audio plus metadata. OGG/Opus is the target for Telegram voice messages and applicable WhatsApp voice-message flows. Validate codec, sample rate, channels, duration, MIME type, and platform limits before sending. Never assume an audio file is a native voice note merely because it is playable.

## Reliability

Use idempotency keys for message sends, persist provider message IDs, retry transient errors only, and never retry an ambiguous send without checking provider state. User approval is a required state transition.
