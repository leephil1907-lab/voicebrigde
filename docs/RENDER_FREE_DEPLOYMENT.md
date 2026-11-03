# Render Pro deployment

This repository is prepared for a single always-on Render Pro Docker web service. It does not create or require a paid Render background worker.

## What runs in the free service

The container starts three components:

- Fastify API, listening on Render's injected `PORT`.
- React web studio, served by Fastify from the built `apps/web/dist` directory.
- Durable dubbing worker, polling the Supabase Postgres queue and converting translated audio with FFmpeg.

The worker is a child process of the web service. The launcher stops both processes together when Render restarts or shuts down the instance.

## Create the service

1. In Render, choose **New → Blueprint**.
2. Connect the GitHub repository `leephil1907-lab/voicebrigde`.
3. Select the `main` branch and use the repository's `render.yaml`.
4. Select the **Pro** instance plan for the web service.
5. During environment setup, enter the two required secret values below.
6. Deploy the Blueprint.

Do not create a separate Background Worker on the free plan.

## Required secrets

Set these in the Render service's Environment page:

| Variable | Value |
|---|---|
| `SUPABASE_SECRET_KEY` | Secret key for the VoiceBridge Supabase project |
| `ELEVENLABS_API_KEY` | A newly generated ElevenLabs API key with Dubbing v2 access |

The Blueprint already provides the Supabase project URL, publishable key, private storage bucket name, FFmpeg executable and upload limits. Never use the Supabase secret key or ElevenLabs key in a `VITE_` or `EXPO_PUBLIC_` variable. Do not commit either secret to GitHub.

## Runtime behavior and Pro instance

A paid Pro web service remains running instead of entering the Free-instance sleep cycle. Because the API and durable worker run in the same container, the worker can continue polling Supabase while the service is live. Supabase remains the durable source of truth for queued and recoverable jobs.

Consequences:

- First visit after inactivity can take time while the free service wakes.
- A queued translation may wait until the service is awake.
- Long-running translation processing is not guaranteed to continue while the instance is asleep.
- A single free instance runs both Node processes and FFmpeg, so avoid simultaneous heavy audio jobs.
- This setup is intended for initial testing and low-volume use, not always-on production delivery.

The API and worker share the same Render instance and environment variables. Do not add a second worker service until measured queue depth, CPU, memory, or processing time justifies the extra monthly cost.

## Existing service plan change\n\nThe current VoiceBridge service was created directly in Render, not from a Render Blueprint. Changing `render.yaml` alone will therefore not change its live instance plan. In the Render dashboard, open the `voicebridge` web service, go to **Settings → Instance Type**, select **Pro**, and save the change. Verify the service details show `plan: pro` after Render applies it. The Blueprint file also declares `plan: pro` for future Blueprint-created deployments.\n\n## Deployment checks

After Render reports the service as Live:

1. Open the service URL. The VoiceBridge web studio should load.
2. Open `/health`. A healthy response should report `status: "ok"`, with database and private storage capabilities enabled.
3. Open `/config`. Confirm the Supabase URL and publishable key are present; secret values must never appear.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to your actual Render URL (for example `https://voicebridge-9unm.onrender.com`) and add that origin or its `/**` path to Redirect URLs. In **Authentication → Sign In / Providers**, enable Email. If email confirmation is enabled, make sure mail delivery is configured; users must click the confirmation link before signing in. Supabase's default email service can have restrictions and low limits; configure a suitable SMTP provider for real users. Sign up with a real test email, confirm it if required, and sign in.
5. Submit a short recording with voice-processing consent and a target language.
6. Watch the job status until the worker completes it; listen to the returned preview.
7. Check Render logs for both the API startup message and `VoiceBridge durable worker started`.

A successful deployment and healthy endpoint do not, by themselves, prove ElevenLabs translation works. Confirm with a real short test recording before inviting users.

## Mobile app configuration

For an Android build, set the mobile app's build-time variables using the deployed HTTPS service URL:

- `EXPO_PUBLIC_API_URL=https://YOUR-RENDER-SERVICE.onrender.com`
- `EXPO_PUBLIC_SUPABASE_URL=https://kggllnqkryquornprphu.supabase.co`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the project's publishable key

Only the publishable key belongs in the mobile app. The Supabase secret and ElevenLabs key remain in Render.
