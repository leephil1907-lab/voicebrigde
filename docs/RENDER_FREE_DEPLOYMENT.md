# Render deployment

VoiceBridge is configured as one Render Pro Docker web service. The container runs the Fastify API, serves the built web studio, and runs the durable dubbing worker as a supervised child process. Supabase Postgres and private Storage hold durable jobs and audio; Render's local filesystem is not used for persistent job data.

## Current deployment state

The previous Render service was deleted. No live VoiceBridge Render URL should be assumed until a new service has been created and its deployment verified.

## Create a new service

1. Open the Render dashboard and choose **New → Blueprint**.
2. Connect the GitHub repository `leephil1907-lab/voicebrigde`.
3. Select branch `main` and let Render read the root `render.yaml`.
4. Confirm the service is named `voicebridge`, uses the Docker runtime and the **Pro** plan in Frankfurt.
5. Add the required secrets listed below when Render prompts for them.
6. Create the Blueprint and wait for the first deployment to finish.

The Blueprint is the preferred path because it keeps the service configuration in version control. If creating a Web Service manually instead, use the repository, `main` branch, Docker runtime, root `Dockerfile`, Frankfurt region, Pro plan and health-check path `/health`.

## Required environment secrets

- `SUPABASE_SECRET_KEY`: secret key for the existing VoiceBridge Supabase project.
- `ELEVENLABS_API_KEY`: ElevenLabs API key with Dubbing v2 access.

The Blueprint supplies the Supabase URL, publishable key, private bucket name, FFmpeg path, upload limits and translation quota. Never put either secret in the mobile app, a `VITE_*` variable, or GitHub.

## Runtime and health checks

Render supplies `PORT` and `RENDER_EXTERNAL_URL`. The API listens on `PORT`; CORS automatically allows the service's current Render URL and the explicitly configured local development origins. This avoids binding the deployment to a deleted Render hostname.

After deployment:

1. Open the generated Render service URL and confirm the VoiceBridge web studio loads.
2. Open `/health`. It must return HTTP 200 and `status: "ok"`.
3. Open `/config`. Confirm the Supabase URL and publishable key are present. Provider and Supabase secret keys must never be returned.
4. Inspect logs for both the API startup and `VoiceBridge durable worker started`.
5. Create or sign into an owner-controlled account and verify the session persists.
6. Submit one short test recording, wait for the durable worker to complete it, and listen to the translated preview. This consumes ElevenLabs credits.

A healthy endpoint does not prove that the full dubbing pipeline works. Complete the real translation test before inviting users.

## Supabase setup

The existing Supabase project is separate from Render and is not deleted when a Render service is deleted. Confirm that all migrations in `supabase/migrations` have been applied, that the `voicebridge-private` Storage bucket exists and is private, and that Email authentication is enabled.

After the new Render URL is known, set the Supabase Auth Site URL to that URL and add it to the allowed Redirect URLs. Configure SMTP before public onboarding if Supabase's default email service is insufficient.

## Mobile app configuration

Set the Android build-time public variables to the new service URL:

- `EXPO_PUBLIC_API_URL=https://YOUR-NEW-VOICEBRIDGE.onrender.com`
- `EXPO_PUBLIC_SUPABASE_URL=https://kggllnqkryquornprphu.supabase.co`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the project's publishable key

Only the publishable key belongs in the mobile app.

## Important operational notes

- The API and worker run in one container. A restart stops both; queued jobs remain in Supabase and can be reclaimed by the worker after restart.
- Pro keeps the service running; a Free service can sleep and pause job processing.
- Keep concurrency and audio limits conservative because FFmpeg and the dubbing worker share the web-service resources.
- WhatsApp Business and Telegram require official provider credentials and the approved sender UUID allowlist. Personal WhatsApp sharing uses Android's sharesheet and does not guarantee a native voice-note bubble.
- The repository's CI workflow checks TypeScript, API/web tests, browser end-to-end tests and a Docker image build. CI passing is necessary but does not replace live Supabase and ElevenLabs acceptance tests.
