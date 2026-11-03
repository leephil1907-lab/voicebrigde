# Personal WhatsApp pilot: engineering status

Status: **not connected or sendable**. A fail-closed owner/consent policy and an isolated transport function have been unit-tested against a mock linked-device socket; no real WhatsApp driver or account has been tested. It is not wired into an API endpoint or UI. Do not present it as a working integration or use it with an account yet. The existing website retains manual OS sharing; that may produce an attachment.

A personal-account integration would use an unofficial WhatsApp Web protocol, which could break or violate provider terms and may lead to account restrictions. Use a secondary test account only after explaining the risk. A linked-device session can have broad access: never expose QR codes, pairing codes, credentials, chat data or tokens in logs, URLs, chat, or to other users.

## Requirements before any owner-only pilot

- A disabled-by-default feature flag and one server-configured Supabase owner UUID. Authenticate every request, compare the owner UUID server-side, use rate limits and protect pairing operations from CSRF/replay. The standalone policy in `apps/api/src/pilot/personal-whatsapp-policy.ts` checks ownership and consent but is not a security boundary until called by authenticated routes.
- Connect via an isolated, pinned and reviewed provider adapter; no automatic incoming replies, messages, contact imports or bulk sends. Provide mobile-friendly pairing and explicit logout/unlink guidance. Test on the actual Android version and secondary account; a single phone may require a pairing-code flow or another screen.
- Encrypt sessions at rest using a stable server-only key, restrict database/storage access to the server, serialize updates safely, support account revocation and deletion. Render's ephemeral filesystem is not durable storage. Avoid multiple processes or instances using the same session without a lock. Do not log secrets or contact/message content.
- Require a completed job owned by the owner, recipient E.164, voice permission, preview confirmation and recipient consent; reserve idempotency transactionally before a provider call. Treat ambiguous send outcomes as unknown, never retry automatically. Verify native voice bubble and playback on controlled recipient devices; provider acknowledgement is not proof of delivery.
- Review upstream packages, transitive licenses, vulnerabilities and terms before shipping. Do not include outdated vulnerable releases. Run CI, a security review and a real-device test before enabling the pilot.

## Live sessions: separate milestone

ElevenLabs documents an enterprise realtime translation WebSocket at `wss://api.elevenlabs.io/v1/translation/realtime`, with `target_language` and a separately registered `voice_id` and streamed input/output. Provider keys must stay on the server. A two-way in-app call needs authenticated room membership, two separate translation streams, speaker consent, latency handling, audio routing, metering and cleanup. This is not an integration into personal WhatsApp calls, and has not been implemented or validated here. See https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime and docs/REPOSITORY_RESEARCH.md.

## Deployment checks

Set Supabase Auth Site URL and allowlisted redirect URLs to the actual production HTTPS origin. A redirect to localhost on a phone cannot reach the deployed site. Apply migrations, check a private bucket, configure the existing server secrets, and test a real signup, translation and download. Never include keys in browser code or logs. Render deployment and live provider behavior have not been verified in this workspace.

## Waveform investigation

The standard Web Share API passes a file to the recipient app; it has no documented WhatsApp-specific voice-waveform field. VoiceBridge cannot force WhatsApp to use waveform metadata through that share sheet. A flat line does not prove the audio itself is faulty. The user observed a native-looking bubble but a flat line for both website sharing and file attachment on their device.

For the unconnected pilot, `waveformFromPcm16` computes 64 normalized amplitude bins from decoded mono PCM; the experimental transport can supply these and a duration to a future linked-device driver. This is groundwork only: no FFmpeg decoding is wired into this helper, no provider driver is connected, no real WhatsApp delivery or waveform display has been tested, and some linked-device libraries may require constructing a lower-level message for metadata to survive. Never claim the current share-sheet waveform is fixed. A real implementation must derive metadata from the exact output, test silence and variable speech on both sending/receiving phones, and handle failed sends without duplicate retries.

## Recording directly inside personal WhatsApp on Android

A normal website or Android app cannot be assumed to intercept an unsent voice recording inside another app, translate it, replace WhatsApp's microphone stream and return it to that chat before send. Android's documented microphone arbitration generally allows only one ordinary app to receive the mic at a time: https://developer.android.com/media/platform/sharing-audio-input . This is different from importing a recording the user explicitly shares out of WhatsApp. There is no demonstrated official personal WhatsApp integration in this project that provides the requested intercept-and-replace flow.

For the current supported flow, record in VoiceBridge, translate, preview and manually share to WhatsApp; user testing has shown a voice-message-looking bubble on their phone, but its waveform is a straight line. The receiving app decides how to render shares. The owner-only linked-device experiment could enable a manually initiated send from a personal account and may allow waveform metadata, but it is unofficial and still incomplete. It does not automatically translate WhatsApp's own unsent recording.

For live conversation, begin with a two-person VoiceBridge room shared as a link in WhatsApp. Both participants join VoiceBridge and consent; independent ElevenLabs realtime streams translate each direction. This is not a WhatsApp call and is not implemented. Hardware-specific call translation features may exist on some phones; they should not be represented as supported by VoiceBridge without device testing.
