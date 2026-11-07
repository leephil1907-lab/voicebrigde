# Voice profiles, consent and billing foundations

This phase adds account-scoped persistence for reusable voice profiles, consent evidence, usage metering, credit balances, subscription state and idempotent billing webhook events.

## Data model

- `voicebridge_voice_profiles`: user-owned profile metadata and private reference-audio path. A profile becomes active only when explicit consent metadata is present. Provider voice IDs are optional because a provider may use source-audio dubbing rather than a reusable cloned voice.
- `voicebridge_voice_consents`: append-only consent evidence, scope, version, text hash and optional private evidence path. Revocation is timestamped.
- `voicebridge_usage_events`: idempotent usage records for translation starts/completions, audio seconds and messaging actions.
- `voicebridge_credit_accounts` / `voicebridge_credit_transactions`: non-negative available credit balance and idempotent ledger transactions. Balance mutations must occur in a server-side database transaction/RPC; never accept a balance from the browser.
- `voicebridge_subscriptions`: normalized subscription state for a payment provider, including plan, billing interval and period.
- `voicebridge_billing_events`: provider webhook event IDs for idempotent processing. Payloads are server-only.

All public tables enable RLS. Authenticated clients can only select rows matching their own `auth.uid()`; all mutations and webhook processing remain server-side with the Supabase secret key. No service-role/secret key belongs in a browser or Expo bundle.

## Commercial model (catalogue to be finalized)

The database supports four commercial paths without hard-coding a payment processor or price:

- **Free** — limited monthly translations and capped audio duration.
- **Creator / Pro** — monthly or annual subscriptions with larger allowances.
- **Pay as you go** — prepaid credits, debited by server-side usage.
- **Business / Enterprise** — negotiated seats, quotas and support.

Prices, credit conversion, free-tier allowance, refund policy, tax handling and payment-provider account must be confirmed before checkout is enabled. Do not present a live checkout button until the provider is configured, webhook signature verification is implemented, and payment/credit reconciliation is tested.

## Required implementation sequence

1. Apply this migration after the durable-jobs migration and verify every table's RLS/grants.
2. Add authenticated API routes for profile CRUD, consent grant/revocation, usage summary and billing portal/checkout session creation.
3. Implement transaction-safe credit reservation and settlement; avoid client-side arithmetic.
4. Connect a payment provider using server-only secrets and signed webhook verification. Use provider event IDs as the idempotency key.
5. Add web and mobile profile, consent, usage and plan screens.
6. Add integration tests for cross-user isolation, duplicate webhooks, repeated credit debits, revoked voice consent and account deletion/retention.

## Voice identity and messaging limits

A reference recording can guide voice-preserving dubbing, but identity, accent, emotion and timing are provider-dependent and must be previewed. Voice profiles require the speaker's authorization and a revocation path. WhatsApp share-sheet delivery is user-confirmed file sharing; a native voice-note bubble cannot be guaranteed by the browser share API. Any future direct messaging delivery must use an approved, documented platform integration and explicit recipient confirmation.
