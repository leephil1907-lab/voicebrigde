# WhatsApp integration architecture

VoiceBridge supports both personal WhatsApp and WhatsApp Business, but they are separate delivery adapters with different permissions and send semantics.

## 1. Personal WhatsApp (Android share hand-off)

The mobile app downloads the translated preview into its private cache and calls Expo Sharing with the audio file URI and `audio/mpeg` MIME type. Android displays the system sharesheet; the user chooses WhatsApp, selects a conversation, and confirms sending.

- No personal WhatsApp password, session cookie, QR login, or unofficial automation is used.
- VoiceBridge does not select a recipient or press Send on the user's behalf.
- The share action is an audio-file hand-off. WhatsApp may display it as an audio attachment rather than a microphone-recorded native voice-note bubble. This must be checked on supported Android versions and WhatsApp releases.
- The translated preview remains available in VoiceBridge for replay before sharing.

## 2. WhatsApp Business (official Cloud API)

`apps/api/src/messaging/whatsapp-business.ts` implements the server-side Cloud API adapter:

1. Validate the destination international phone number.
2. Require an OGG/Opus audio asset prepared by the audio worker.
3. Upload the audio to the registered WhatsApp Business phone-number ID media endpoint.
4. Send an audio message referencing the returned media ID, with the voice-message flag enabled.
5. Return the provider message ID for delivery-status tracking.

The adapter accepts credentials as function arguments. It does not read credentials from the mobile app and it is not exposed as an unauthenticated HTTP route.

### Required production work before enabling Business sending

- Complete Meta Business verification / WhatsApp Business Platform onboarding and register the sending phone number.
- Configure a long-lived system-user access token with the required WhatsApp messaging permission, phone-number ID, WABA ID, and Graph API version in the server secret manager.
- Add account authentication and authorization to VoiceBridge. A user must be linked to a business workspace and an authorized WhatsApp Business sender before a send route is exposed.
- Add a persistent send-job record, idempotency key, recipient consent / policy checks, rate limits, and audit trail.
- Add Meta webhook verification and message-status handling (sent, delivered, read, failed).
- Convert provider output to OGG/Opus in the background audio worker before calling the adapter. Do not send MP3 bytes while labelling them as OGG/Opus.
- Apply WhatsApp's customer-service window, template, opt-in, and messaging policies to the recipient and conversation context.

The adapter is deliberately not wired to a public send endpoint yet: the current API does not have user authentication or business-account authorization. Exposing a send endpoint before those controls exist would let unauthenticated callers spend the connected business account's messaging quota.

## Shared translation flow

Both channels consume the same approved translated audio asset:

`record/import → audio-to-audio translation → preview → choose delivery channel → explicit send confirmation → delivery status`

The production translation engine should be audio-to-audio dubbing with automatic speaker matching, not only transcript translation followed by generic TTS. Preserve the original recording as an immutable source and retain separate translated assets per target language.

## Acceptance tests

- Personal Android: audio opens in the system share chooser; WhatsApp is available when installed; the selected chat receives a playable audio file; verify whether the target app presents an attachment or native voice-note bubble.
- Business: upload succeeds; audio is accepted as OGG/Opus; API returns a WhatsApp message ID; webhook status is correlated to the persisted send job.
- Both: recipient and target language are visible before sending; no send occurs during translation or preview; retries cannot create duplicate sends; provider errors are shown clearly.
