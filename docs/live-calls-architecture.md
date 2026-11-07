# VoiceBridge live calls — architecture and rollout

## Product scope

VoiceBridge supports two separate call entry points on one translation core:

1. **In-app live call:** two signed-in VoiceBridge users connect to each other and hear the other speaker translated into their own spoken language.
2. **WhatsApp live call:** a user starts a WhatsApp voice call to the official VoiceBridge Business number. VoiceBridge bridges the call into the same two-way translation core.

The existing voice-note dubbing and WhatsApp voice-note delivery flows remain separate and unchanged.

## Shared translation core

Use OpenAI `gpt-realtime-translate` for continuous speech-to-speech translation. Keep the standard API key on the server. The API creates short-lived client secrets, with each listener's spoken language configured as the translation output language.

For a two-person call, there are two independent translation directions:
- Participant A audio → translated into Participant B's spoken language.
- Participant B audio → translated into Participant A's spoken language.

Keep source audio tracks separate. Do not mix both speakers before translation. Preserve original-audio passthrough when the model does not translate a same-language segment, and duck original audio only while translated audio is available.

## In-app call media and signaling

- Auth: existing Supabase Auth access token, verified by the API.
- Call state: `voicebridge_live_calls` and `voicebridge_live_call_participants`.
- Signaling: private Supabase Realtime Broadcast topic `voicebridge:call:<call_uuid>`; database policies permit only active participants to send or receive.
- Media: browser WebRTC peer connection for the initial two-person experience.
- Translation: one Realtime Translation WebRTC sidecar per listener, attached to the remote participant's microphone track.
- Captions: consume translation/source transcript events from the `oai-events` data channel; do not persist transcripts by default.
- Call lifecycle: API-created invitation token is random, stored only as a SHA-256 hash, expires after 15 minutes, and is single-use. Call and participant metadata is retained in Postgres; audio is not recorded.

The API implements authenticated create/join/read/end routes and issues a short-lived translation client secret only to an active participant after both seats are occupied. The web app now includes a Live calls screen, invitation links, private Realtime signaling, browser WebRTC audio, and one translation sidecar per listener. This first browser media path is a two-person implementation; TURN/SFU hardening and real-device testing remain release gates.

## WhatsApp Business Calling

Use the official WhatsApp Business Platform Calling API, not Baileys or a personal WhatsApp account. Use LiveKit's WhatsApp connector as the media bridge:

1. User-initiated WhatsApp call reaches the registered VoiceBridge Business number.
2. Meta sends the call offer webhook to the VoiceBridge API.
3. API validates Meta's webhook signature, deduplicates the event, and maps the WhatsApp call to a LiveKit room.
4. LiveKit connects the WhatsApp call media to the room.
5. A backend media worker opens a server-side Realtime Translation WebSocket per direction, converts media to/from 24 kHz PCM16 as required, and routes translated audio back to the other participant.
6. Meta terminate events trigger provider disconnect and room cleanup.

The existing personal-device pairing pilot is not used for this feature.

### WhatsApp onboarding prerequisites

- A dedicated phone number for the VoiceBridge Business account.
- Meta Business Portfolio and WhatsApp Business Account.
- Meta app with WhatsApp product, phone-number registration, and Calling enabled for the number.
- Long-lived system-user access token with the required WhatsApp permissions.
- Phone Number ID, WABA ID, Meta App Secret, webhook verify token, and selected Graph API version.
- Planned public HTTPS webhook URL: `https://voicebridge-81xs.onrender.com/v1/webhooks/whatsapp`. Do not configure it in Meta until the webhook handler and LiveKit connector bridge are deployed.
- LiveKit Cloud project URL, API key, and API secret.
- OpenAI API key with Realtime Translation access and billing enabled.

**Nigeria calling constraint:** launch with inbound, user-initiated WhatsApp calls. Twilio's current WhatsApp Business Calling documentation lists Nigerian business numbers as unavailable for business-initiated outbound calls. Do not design the first release around VoiceBridge calling a customer first. Re-check Meta/provider eligibility for the actual registered number during onboarding.

## Configuration keys

Server-side Render environment variables:
- `OPENAI_API_KEY`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_BUSINESS_ACCOUNT_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_GRAPH_API_VERSION`
- `META_APP_SECRET`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Never place any of these in `VITE_*`, Expo public config, or browser code.

## Release gates

1. Add and verify the in-app call UI, private signaling, reconnect, mute, speaker routing, and end-call cleanup.
2. Run two-browser tests for English ↔ Spanish, English ↔ French, and English ↔ Hausa; test same-language passthrough and noisy mobile networks.
3. Add usage metering for live-call audio seconds before enabling paid calls. Do not silently consume voice-note credits; live calls need a separate metering rule.
4. Configure Meta webhooks and LiveKit WhatsApp connector using the dedicated business number.
5. Test inbound WhatsApp calls from at least two real WhatsApp accounts; verify language selection, two-way audio, call termination, webhook retries, and billing.
6. Keep recording/transcription off by default unless both participants explicitly consent.

## Current implementation status

- Database schema and RLS: applied.
- Private Realtime signaling access policies: applied.
- Authenticated in-app call lifecycle API: committed.
- Short-lived OpenAI translation session issuance: committed; requires `OPENAI_API_KEY`.
- In-app WebRTC call UI/media orchestration: committed; requires build verification, API key, TURN/SFU production hardening, and two-device testing.
- WhatsApp Meta webhook + LiveKit media bridge: pending provider credentials and implementation.
- Live-call usage metering: pending.
