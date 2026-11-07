# VoiceBridge AI

**Your voice. Every language.**

VoiceBridge AI is an Android-first multilingual voice messaging application. Users record a message in their own language, translate it while retaining the original speaker's vocal identity and delivery as closely as possible, preview it, and send it through supported messaging integrations.

## Product principles

- Preserve the speaker's recognizable voice where the selected voice provider and target language support it.
- Show the provider's source and translated transcripts when available, and provide an audio preview before sending.
- Send native voice messages only through documented, supported platform APIs.
- Keep personal WhatsApp and WhatsApp Business delivery paths distinct.
- Never automate or scrape personal messaging accounts through unofficial interfaces.
- Protect voice recordings, voice profiles, provider credentials, and messaging tokens.

## Repository layout

```
apps/
  mobile/             Expo React Native Android application
  api/                Fastify + TypeScript API
packages/
  contracts/          Shared API and domain contracts
  config/             Shared TypeScript and lint configuration
supabase/
  migrations/         Database schema, RLS policies and durable queue
docs/
  architecture/       Architecture decisions and integration notes
  product/            Product requirements and UX flows
```

## AI voice translation pipeline

The primary voice engine now uses asynchronous ElevenLabs Dubbing v2 rather than the previous chained transcription → text translation → generic cloned TTS path:

1. Record a message on Android.
2. Upload the recording to the Fastify API; source-language detection is automatic unless a source language is explicitly supplied.
3. Create an ElevenLabs Dubbing v2 project, wait for source preparation, then queue the target language with cloning strength 8/10.
4. Poll the asynchronous job until dubbing completes; the model uses the speaker in the source recording as the voice reference and aims to preserve identity, emotion, timing and tone.
5. Convert the WAV result to mono OGG/Opus with FFmpeg for WhatsApp-compatible voice-note delivery.
6. Retrieve the source and translated segment transcripts when available.
7. Preview the translated audio before choosing a delivery channel.

Configure `ELEVENLABS_API_KEY` and ensure FFmpeg is installed (the root `Dockerfile` installs it). Dubbing v2 is designed to preserve speaker identity, emotional tone and timing, but results still require listening tests. See [the voice engine guide](docs/architecture/voice-engine.md) and [the durable jobs/auth architecture](docs/architecture/durable-jobs-and-auth.md).

## Enabled languages

VoiceBridge currently exposes a curated set of 18 Dubbing v2 target languages: English (`en`), Spanish (`es`), French (`fr`), Portuguese (`pt`), German (`de`), Italian (`it`), Arabic (`ar`), Chinese (`zh`), Japanese (`ja`), Korean (`ko`), Hausa (`ha`), Yoruba (`yo`), Swahili (`sw`), Hindi (`hi`), Dutch (`nl`), Russian (`ru`), Turkish (`tr`) and Urdu (`ur`). The API returns this allowlist through `/v1/languages` and rejects target codes outside it. ElevenLabs Dubbing v2 supports 90+ languages; this curated list is the subset currently enabled in the VoiceBridge interface. See [ElevenLabs supported Dubbing languages](https://elevenlabs.io/docs/overview/capabilities/dubbing).

## Sharing translated audio to WhatsApp

The live web studio prepares the translated output as mono 48 kHz OGG/Opus using the existing FFmpeg worker. On supported Android browsers, **Share with an app** opens the system share sheet with an `audio/ogg` file. The user chooses WhatsApp, selects the recipient and confirms the send in WhatsApp. No personal account is linked and VoiceBridge does not send automatically. Download remains a separate, explicit action; the share button does not silently download.

WhatsApp controls how shared audio is displayed. The Web Share API cannot attach WhatsApp-specific voice-note or waveform metadata, so neither a voice-note bubble nor waveform bars can be guaranteed. Test on the target Android browser and WhatsApp version; a flat waveform has been observed. The website waveform is derived from the translated audio when browser decoding is supported and is not metadata supplied to WhatsApp.

If file sharing is unsupported, the site reports this rather than automatically downloading or sending. If preparation fails, use Refresh preview to retrieve a fresh audio link. A native Android app or unofficial linked-device transport is not required for this browser flow; neither is a production WhatsApp integration of the website.

## Durable jobs and authentication

- Supabase Auth provides email/password accounts and persistent mobile sessions.
- The API verifies each access token with Supabase Auth before accepting or reading a translation.
- Source recordings and translated OGG/Opus outputs live in a private Supabase Storage bucket, under a user-specific path.
- `voicebridge_jobs` stores each job, provider project/language IDs, transcripts, retry state and output path in Postgres.
- The separate `dubbing-worker` process claims jobs atomically with `FOR UPDATE SKIP LOCKED`, heartbeats its lease, resumes provider work after restarts, and retries failed attempts with backoff.
- The queue uses Postgres directly; Redis and BullMQ are not required for this first durable-worker implementation.

For Render Free, the API and durable worker run as two child processes inside one free web service. The Docker image installs FFmpeg, builds the API and web studio, and starts both processes with `npm run start:render`. The Postgres queue remains durable in Supabase when the Render instance sleeps or restarts. Until billing and credit metering are implemented, each account is limited to three translations per rolling 24 hours (configurable with `MAX_TRANSLATIONS_PER_USER_PER_DAY`) to cap provider spend.

## Technology baseline

- Mobile: Expo + React Native + TypeScript + Supabase Auth
- API: Node.js + Fastify + TypeScript
- Database and authentication: Supabase Postgres + Auth + private Storage
- Background processing: Postgres queue with atomic worker leases
- Audio processing: FFmpeg in the co-hosted durable worker process
- Speech, translation and voice generation: provider adapters; credentials remain server-side
- Deployment: Render Free single web service (API + worker in one container); separate always-on worker can be added later on a paid plan

## Voice profiles, consent and monetization foundation

The full-platform work is being delivered in phases. The account and billing foundation migration adds owner-scoped voice profiles, explicit consent and revocation records, usage metering, credit ledgers, subscription state and idempotent billing webhook records. See [the architecture and implementation sequence](docs/architecture/profiles-consent-and-billing.md). Apply migrations in filename order only after the Supabase project is active. The schema does not activate checkout by itself: a payment provider, server-side credit settlement, signed webhook verification, pricing and tax/refund policies must be configured and tested before accepting payments.

Voice cloning and reference-audio use require the speaker's authorization. Provider voice IDs are optional because the current dubbing workflow uses the source recording as a reference and does not guarantee a persistent cloned voice profile. Every translation must remain previewable and revocable consent must prevent future use of that profile.

## Render deployment

The repository Blueprint declares one Render Pro Docker web service hosting the API, web studio and durable dubbing worker together. Create a new Blueprint deployment from `main`, provide `SUPABASE_SECRET_KEY` and `ELEVENLABS_API_KEY`, and verify the generated service URL and health endpoint. The Supabase URL, publishable key and private bucket name are prefilled in the Blueprint. See [Render deployment instructions](docs/RENDER_FREE_DEPLOYMENT.md).

## Deployment status

The repository includes a Render Blueprint and Docker deployment configuration, but a new Render service must be created and verified before VoiceBridge can be considered live. Deployment success, Supabase connectivity, account authentication and a real ElevenLabs translation are separate checks. WhatsApp Business and Telegram remain disabled until their official provider credentials and approved sender user IDs are configured. Follow [the Render deployment guide](docs/RENDER_FREE_DEPLOYMENT.md) and then [the social platform setup guide](docs/CONNECT_SOCIAL_PLATFORMS.md).

## Local development

Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set the API URL, Supabase project URL and publishable key. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for migration, API, worker and mobile setup instructions.

## Security

Never commit real API keys, access tokens, voice samples, personal recordings, Supabase service-role keys, or WhatsApp credentials. Use environment variables and a secret manager.

## Render deployment

VoiceBridge is configured for one always-on Render Pro Docker web service running the API, React studio and durable worker together. See [the Render deployment guide](docs/RENDER_FREE_DEPLOYMENT.md). The existing Render service must be changed to the Pro instance type in its dashboard; changing `render.yaml` does not alter a service created outside a Blueprint.

### Render Pro setup

The root `render.yaml` defines one paid Pro web service running the API, website and dubbing worker together. See [`docs/RENDER_PRO_QUICKSTART.md`](docs/RENDER_PRO_QUICKSTART.md) for costs, required server-side settings, Supabase email configuration and launch verification. A Pro workspace subscription does not automatically cover the compute charges of additional services.

## Paystack pricing and translation credits

VoiceBridge uses Paystack for NGN checkout. All prices and entitlements are server-owned through `PAYSTACK_CREDIT_PACKAGES_JSON` and `PAYSTACK_SUBSCRIPTION_PLANS_JSON`; clients submit only a product code. Amounts are in kobo. Never place Paystack secret keys in the web or mobile bundle.

**Credit unit:** 60 credits = one billable minute. Audio is billed in whole-minute blocks, rounded up, for each target language. A two-minute recording translated into two target languages consumes four minutes (240 credits). A new account receives a one-time 60-credit trial allowance. Purchased credits can be used alongside subscription allowances. Unused subscription minutes expire at the end of the billing period; purchased wallet credits remain separate from that monthly allowance.

Recommended one-time credit packages:

| Package code | Display name | Price | Credits | Translation time |
|---|---|---:|---:|---:|
| `starter` | Starter | ₦7,500 | 60 | 1 minute |
| `growth` | Growth | ₦35,000 | 300 | 5 minutes |
| `power` | Power | ₦65,000 | 600 | 10 minutes |

Recommended monthly subscriptions:

| Plan code | Display name | Price | Included time |
|---|---|---:|---:|
| `creator` | Creator | ₦19,900/month | 3 minutes |
| `pro` | Pro | ₦49,900/month | 8 minutes |
| `business` | Studio | ₦99,900/month | 18 minutes |

These are launch prices, not a guarantee of margin. Recalculate against the actual provider invoice, FX rate, Paystack fees and support costs before promotions or discounts.

Set the credit catalog on Render to:

```json
[
  {"code":"starter","name":"Starter","description":"1 translation minute · one-time top-up","amountMinor":750000,"credits":60},
  {"code":"growth","name":"Growth","description":"5 translation minutes · one-time top-up","amountMinor":3500000,"credits":300},
  {"code":"power","name":"Power","description":"10 translation minutes · one-time top-up","amountMinor":6500000,"credits":600}
]
```

Create three monthly plans in the Paystack dashboard first, then set the subscription catalog on Render. Replace each `PLN_...` value with the exact plan code from the same Paystack environment as the secret key:

```json
[
  {"code":"creator","name":"Creator","description":"3 translation minutes each month","paystackPlanCode":"PLN_CREATOR","amountMinor":1990000,"interval":"month","includedMinutes":3},
  {"code":"pro","name":"Pro","description":"8 translation minutes each month","paystackPlanCode":"PLN_PRO","amountMinor":4990000,"interval":"month","includedMinutes":8},
  {"code":"business","name":"Studio","description":"18 translation minutes each month","paystackPlanCode":"PLN_STUDIO","amountMinor":9990000,"interval":"month","includedMinutes":18}
]
```

**Metering and refunds:** the API reserves credits atomically before a job becomes visible to the worker. Subscription minutes are used first; purchased credits cover additional usage. Completion settles the reservation. A terminal job failure automatically refunds wallet credits or releases the subscription allowance. Duplicate reservation attempts are idempotent. Paystack-issued customer refunds and disputes are not yet automatically reconciled against consumed credits; keep those under manual review until that workflow is added. The database records completed usage and owner-scoped credit reservations.

### Paystack environment setup

1. Add `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`, `PAYSTACK_CURRENCY=NGN`, and `PAYSTACK_APP_URL=https://voicebridge-81xs.onrender.com` to the Render service environment.
2. Add the two JSON catalogs above as `PAYSTACK_CREDIT_PACKAGES_JSON` and `PAYSTACK_SUBSCRIPTION_PLANS_JSON`.
3. Register the webhook URL `https://voicebridge-81xs.onrender.com/webhooks/paystack` in the matching Paystack test or live dashboard.
4. Test checkout, transaction verification, duplicate webhook delivery, subscription creation/renewal/cancellation, and failed-job refunds before accepting live customer payments.

The API verifies every successful charge directly with Paystack and compares the reference, amount and currency with the server-created pending payment before granting credits. Webhook signatures are checked against the raw request body; fulfillment is idempotent in Postgres. The callback never grants value by itself.

Recurring subscriptions require a Paystack plan code created in the same Paystack environment as the API key. Paystack subscription billing is supported for card and Nigeria direct debit; the payment methods offered depend on the merchant account and plan setup.
