# WhatsApp integration architecture

VoiceBridge supports both personal WhatsApp and WhatsApp Business, but they are separate delivery adapters with different permissions and send semantics.

## 1. Personal WhatsApp (Android share hand-off)

The API converts the Dubbing v2 WAV output into mono OGG/Opus using FFmpeg. The mobile app downloads that `.ogg` asset into its private cache and opens the Android sharesheet; the user chooses WhatsApp, selects a conversation, and confirms sending.

- No personal WhatsApp password, session cookie, QR login, or unofficial automation is used.
- VoiceBridge does not select a recipient or press Send on the user's behalf.
- **Do not promise a native voice-note bubble for personal WhatsApp.** Android's public share interface hands an audio file to WhatsApp; it does not expose a supported command to create a microphone-recorded PTT message inside a personal account. Even when the shared file is OGG/Opus, WhatsApp's presentation can vary by app version and share path. The sender remains the user's personal WhatsApp account, but native voice-note appearance is not guaranteed.
- The translated preview remains available in VoiceBridge for replay before sharing.

## 2. WhatsApp Business (official Cloud API)

`apps/api/src/messaging/whatsapp-business.ts` implements the server-side Cloud API adapter:

1. Validate the destination international phone number.
2. Require an OGG/Opus audio asset prepared by the audio worker.
3. Upload the audio to the registered WhatsApp Business phone-number ID media endpoint.
4. Send an audio message referencing the returned media ID, with the voice-message flag enabled.
5. Return the provider message ID for delivery-status tracking.

The adapter accepts credentials as function arguments. It does not read credentials from the mobile app. The authenticated `POST /v1/voice/deliver` API route calls it only after checking the signed-in Supabase user against `VOICEBRIDGE_ALLOWED_USER_IDS`, confirming the translated job belongs to that user, and requiring explicit preview and recipient-consent confirmations. With mono OGG/Opus audio and the Cloud API `audio.voice: true` flag, this is the supported route for a native WhatsApp voice-message presentation. The message is sent from the registered WhatsApp Business number and its business profile, not the user's personal WhatsApp number.

### Remaining production work before general release

- Complete Meta Business verification / WhatsApp Business Platform onboarding and register the sending phone number.
- Configure a long-lived system-user access token with the required WhatsApp messaging permission, phone-number ID, WABA ID, and Graph API version in the server secret manager.
- Add the Supabase user UUID of each approved operator to `VOICEBRIDGE_ALLOWED_USER_IDS`; this allowlist is checked on every send.
- The API currently persists a `voicebridge_deliveries` record with an idempotency key and confirmation timestamps, then calls the provider synchronously. It records `accepted` or `unknown`; it does not yet have a durable asynchronous delivery worker or automatic retry queue.
- Add Meta webhook verification (including request-signature validation) and message-status handling (sent, delivered, read, failed) correlated by provider message ID.
- Convert provider output to mono OGG/Opus before calling the adapter. The API container includes FFmpeg for this conversion. Do not send WAV/MP3 bytes while labelling them as OGG/Opus.
- Apply WhatsApp's customer-service window, template, opt-in, and messaging policies to the recipient and conversation context.

## Shared translation flow

Both channels consume the same approved translated audio asset:

`record/import → audio-to-audio translation → preview → choose delivery channel → explicit send confirmation → delivery status`

The production translation engine should be audio-to-audio dubbing with automatic speaker matching, not only transcript translation followed by generic TTS. Preserve the original recording as an immutable source and retain separate translated assets per target language.

## Acceptance tests

- Personal Android: audio opens in the system share chooser; WhatsApp is available when installed; the selected chat receives playable OGG/Opus audio. Record whether WhatsApp presents it as a native voice note or an attachment; never mark the personal integration as native-voice-note capable unless confirmed by repeatable device tests.
- Business: upload succeeds; audio is accepted as mono OGG/Opus; the outgoing payload includes `audio.voice: true`; WhatsApp renders a voice-message bubble from the Business sender; API returns a WhatsApp message ID; webhook status is correlated to the persisted send job.
- Both: recipient and target language are visible before sending; no send occurs during translation or preview; retries cannot create duplicate sends; provider errors are shown clearly.
