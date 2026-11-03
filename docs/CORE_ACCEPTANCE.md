# Core readiness and acceptance checklist

The web studio is an asynchronous voice-note workflow, not a live call. The core uses Supabase and ElevenLabs, not the alternative projects investigated in `REPOSITORY_RESEARCH.md`. Automated tests use stubs; passing them does not verify live service behavior.

## Ready for local verification

- Build/API type checking and unit tests: `npm run build:api && npm run build:web && npm run test:api && npm run test:web`.
- Configure Supabase, ElevenLabs, FFmpeg and ffprobe using `WEB_SETUP.md`; run **all** migrations in timestamp order, including `20261103140000_safe_creation_recovery.sql`. Run both API and worker.
- Use a fresh test account and notes from consenting speakers. Provider requests can incur charges, including when project creation succeeds but the response is lost. No credentials should be placed in browser code, git, or chat.

## Browser regression tests

Run `npx playwright install --with-deps chromium` followed by `npm run test:e2e:web`. The tests exercise registration with email confirmation, sign-in persistence and sign-out, failed sign-in, microphone recording, consent and a completed translation preview, plus incoming-note text. Provider responses and the microphone are **mocked** in this suite: it never creates a real account or spends provider credits. The real deployed site does not use the test mocks.

## Manual live acceptance (not yet run)

1. Open the HTTPS site in a browser and sign up/sign in. Check the browser's microphone permission. Record a short English note, stop it, and listen to its local preview.
2. Select Spanish and consent. Translate and confirm a saved job appears in recent notes, progresses, completes, and plays an OGG voice-matched result. Check translated and original transcripts if the provider returns them. Download and independently play the file. Judge voice similarity and translation accuracy.
3. Repeat with French and with a small uploaded M4A/MP3/OGG or WebM. Check the 120-second and 20-MiB limits. Mobile browser MediaRecorder WebM may omit duration metadata; the server falls back to decoding the audio to determine duration. Test this with the deployed FFmpeg installation.
4. Export an incoming non-English voice note from a messaging app with permission, upload it in **Read a voice note**, and compare the English translation and original transcript with the original audio. Repeat with an English voice note. If transcript-edit translation fails, the UI must report it and not label the original foreign-language text as English. Verify that your ElevenLabs account supports Scribe transcript editing in practice.
5. Refresh or sign in again and open a completed note from the history; confirm a new private preview link is returned. Verify a different account cannot access it. Test denied microphone permission, unsupported files, invalid credentials, missing worker, quota exhaustion and provider failure without revealing secrets.
6. Before messaging launch: configure the appropriate provider and authorized sender IDs. Verify recipient consent and WhatsApp conversation eligibility; send a single note to a controlled recipient and confirm the *actual* voice bubble in the recipient app. Telegram recipients must have started the bot and provide their chat ID. Provider acceptance is not proof of delivery. A personal WhatsApp account is not supported by the Business API integration.

## Known release gates

- No live Supabase, ElevenLabs, WhatsApp, Telegram, real-FFmpeg or browser acceptance test has been performed in this sandbox. Test on actual mobile browsers and real messaging clients.
- Voice quality, accuracy, provider language availability, Scribe transcript-edit translation behavior, quotas and costs depend on the configured provider and plan.
- Health/configuration checks only check configuration/database connectivity. They don't confirm a running worker, valid ElevenLabs key or recipient eligibility.
- Messaging is optional, uses shared server credentials restricted by an explicit user allowlist, and lacks provider webhook receipts or self-service linking. This is not a production multi-tenant setup. Confirm uncertain sends with the recipient before retrying.
- Real-time calls, automatic personal WhatsApp inbox access, deletion/retention tooling and a production security review are not implemented.
