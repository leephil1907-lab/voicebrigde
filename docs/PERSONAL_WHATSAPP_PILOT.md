# Personal WhatsApp: owner-only test phase

**Status: implemented behind a disabled-by-default flag; not production-ready or verified with a real WhatsApp account.** This is an unofficial linked-device integration using Baileys 7.0.0-rc14. WhatsApp warns that unofficial links can compromise an account or cause a ban: https://faq.whatsapp.com/378279804439436/ . The existing OS-share workflow remains separate and unchanged.

The code includes phone-number pairing, protected session persistence, explicit disconnect, a confirmed-recipient send flow and waveform generation from the exact Ogg output. The website shows the linking UI only to the configured owner when the flag is enabled. It requires the user to acknowledge the account risk, preview the audio, confirm recipient consent and press send. It never automatically sends or retries a message. Provider acceptance is not proof of delivery. A WhatsApp voice-note bubble or waveform is **not guaranteed**.

## Before enabling for a controlled test

1. Review the unofficial library, dependencies, account/terms risks, encryption/session lifecycle and privacy. There is no independent security audit. `npm audit` has reported existing high-severity advisories requiring review.
2. Apply and verify `supabase/migrations/20261104150000_personal_whatsapp_encrypted_session.sql` in a non-production test project. The migration was exercised against a local PostgreSQL 17 instance with simulated Supabase roles, but has not been executed against the live Supabase project. Tables and the transactional Signal-key RPC must be accessible to the server's service role only.
3. In the server's secure environment, set `PERSONAL_WHATSAPP_OWNER_ID`, `PERSONAL_WHATSAPP_SESSION_KEY` (a randomly generated canonical base64-encoded 32-byte key), `PERSONAL_WHATSAPP_SINGLE_INSTANCE=true`, and `PERSONAL_WHATSAPP_PILOT_ENABLED=true`. Never paste keys, login codes or pairing codes into chat, logs or source control. The acknowledgment does not technically enforce one instance: the operator must ensure exactly one API instance. No distributed session lock exists.
4. Test with an expendable secondary WhatsApp account first. In the owner account, open Connections, accept the warning, request a pairing code and enter it only in WhatsApp's own Linked devices screen. Verify a 515 reconnect, restart recovery, disconnection in both apps, key persistence, server failures and log redaction.
5. Translate a consented recording, preview, enter a consenting recipient's number, confirm and send. Verify the recipient, bubble type, playback, waveform on both devices, and uncertain outcomes. Before any repeat after an unknown result, check WhatsApp for the original message. The attempt UUID is reserved before relay and is never automatically replayed.
6. Complete an independent security review, real-device tests, dependency audit and abuse/privacy review before considering wider use. Do not enable for other accounts. The local migration and changes are not evidence of deployment or successful authentication.

## Security and operational limits

Sessions are encrypted per record with AES-256-GCM, random nonces and owner/record-bound authenticated data. The server-only key must be retained securely across restarts and backed up under a rotation/recovery plan. Key loss makes sessions unreadable. Disconnect tries to log out and deletes locally stored records, but if provider logout cannot be confirmed the user must remove the device from WhatsApp's Linked devices. The store serializes writes in one process; it does not protect against multiple instances sharing a session.

No chat listing is implemented; the owner enters the recipient's international number. A database attempt reservation reduces accidental duplicate relay for the same attempt, but the user can intentionally start a new attempt. Network errors can be ambiguous. The website reports that ambiguity instead of claiming delivery. This does not replace WhatsApp's own recipient verification.

## Testing completed locally

API unit tests cover owner checks, encrypted storage, pairing state with mocked sockets, idempotency, failure handling, generated Ogg waveform decoding, and serialization through the actual Baileys protobuf with a mocked media upload. A local PostgreSQL 17 test verified migration reapplication, service-role writes, atomic rollback and role permissions. Browser tests mock provider/network interactions. No real WhatsApp pairing or delivery, live Supabase migration, Android app test, external security assessment, or actual waveform rendering test has been completed.

## Other features

A website cannot reliably intercept and replace an unsent recording inside the personal WhatsApp Android app. A separate VoiceBridge live conversation is not a WhatsApp call and is not implemented. Incoming voice-to-English reading and existing ElevenLabs dubbing continue to use the current backend.
