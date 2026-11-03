# VoiceBridge on Render Pro

This guide covers the **existing single-service Blueprint**. It runs the website, Fastify API and dubbing worker in one paid Render web-service instance. Supabase remains the database and private audio store; ElevenLabs performs the voice processing. No separate Render background worker is created by this Blueprint.

## Before deploying

- A Render Pro **workspace subscription** and a service's **compute plan** are separate. `render.yaml` specifies `plan: pro` (Render's legacy name for `2c-4g`, currently 2 CPU / 4 GB). This provisions paid compute; check your Render pricing and confirm the selected plan and region before deployment. A separate background worker would be another paid service and is not required by this setup.
- The Blueprint is configured for the existing Supabase project. Verify the project URL and publishable key before use. Apply all migrations under `supabase/migrations` in filename order to that project. Confirm `voicebridge-private` exists and is private. Do not put secret keys in the repository.
- Make sure email/password auth is enabled in Supabase. After Render assigns the **actual service URL**, configure that URL as the Supabase Auth Site URL and allow it under Redirect URLs. Configure production SMTP and its sender/domain for public registration; email verification and password recovery depend on delivery and Supabase settings.

## Create or update the Render service

1. Push this repository's `render.yaml` and root `Dockerfile` to the branch you will deploy.
2. In Render, select **New → Blueprint**, connect `leephil1907-lab/voicebrigde`, select the correct branch and root `render.yaml`. If you already have a Blueprint for the same service, review its sync rather than creating an unnecessary duplicate.
3. Review the service name, Frankfurt region, plan and projected charges. The Dockerfile installs Node 22 and FFmpeg, builds the API and website, and starts the API and worker under a supervisor. Render injects `PORT` and the public origin. `/health` is the Blueprint health check.
4. In the Render service's **Environment** settings, securely configure `SUPABASE_SECRET_KEY` and `ELEVENLABS_API_KEY`. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must match the project. Never paste secrets into chat, GitHub, or a `VITE_` / `EXPO_PUBLIC_` variable. Use an ElevenLabs plan with Dubbing v2 and Scribe transcript editing access.
5. Save and deploy. Do not create a separate worker when using this combined launcher: it would duplicate processing capacity and incur additional charges. If you later scale to multiple web instances, each instance starts a worker; the database queue uses leases but costs and concurrent workload increase.
6. Set Supabase Auth Site URL and Redirect URLs to the new HTTPS service origin. Include each approved custom domain if applicable. If the website runs on a custom domain or separate frontend, add its full origin to `CORS_ORIGIN` (comma-separated), and configure its Supabase redirects.

## Optional platform connections

WhatsApp Business and Telegram are not connected automatically. Add provider-specific values only in Render's Environment settings when ready: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_VERSION`, `TELEGRAM_BOT_TOKEN`, and `VOICEBRIDGE_ALLOWED_USER_IDS`. Consult `docs/CONNECT_SOCIAL_PLATFORMS.md` or the repository's messaging guide for exact onboarding. This is a shared deployment credential model restricted by the user UUID allowlist; it is not personal WhatsApp linking or per-user OAuth. Business messaging policy and recipient consent apply. See provider docs and test with controlled recipients.

## Verification after deployment

1. In Render logs, find `VoiceBridge API and durable worker started` and `VoiceBridge durable worker started`. If either child process exits, the launcher stops the service so Render can restart it.
2. Open the actual site URL and `/health`; the latter should return HTTP 200. Health checks validate database/bucket connectivity and presence of a key, not a working ElevenLabs account or a live worker heartbeat. `/config` should expose only public configuration, not secret credentials.
3. Sign up with an email you control, confirm the email if required, sign in and refresh the page. Test password recovery. Do not send credentials to support.
4. Record a short permitted voice note, select Spanish or French, consent, and translate. Wait for processing and listen to the preview. Verify an incoming voice-note-to-English-text conversion. ElevenLabs operations can cost money and may return errors due to plan, quotas, language support or audio quality.
5. Check logs if a job fails or stalls, excluding tokens and private content when sharing logs. The default configured translation quota is **3 per user per day**; adjust `MAX_TRANSLATIONS_PER_USER_PER_DAY` in Render if appropriate for your costs and workload. See `docs/CORE_ACCEPTANCE.md` for a fuller checklist.

Render Pro paid instances do not have the Free service's automatic idle spin-down, but deployments, restarts, failures and provider outages can still interrupt work. Supabase-backed queue leases allow recovery where safe. An ambiguous provider project-creation attempt is not automatically retried because it may already have incurred a charge.
