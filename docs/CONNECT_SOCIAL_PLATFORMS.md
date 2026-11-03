# Connect VoiceBridge to WhatsApp, Telegram and your website

This guide is for the live deployment: https://voicebridge-9unm.onrender.com

VoiceBridge is already hosted on Render and its API is connected to Supabase. Messaging platforms are connected through official server-side APIs. Do not paste tokens into the website's browser code, GitHub source, or a public chat.

## 1. WhatsApp Business Cloud API

This is the supported automated connection. Messages are sent from your registered WhatsApp Business number. It is separate from your personal WhatsApp account.

### Create the Meta connection

1. Open [Meta for Developers](https://developers.facebook.com/) and sign in with the Facebook account that owns or administers your business.
2. Create a Meta app and add the **WhatsApp** product.
3. Open the WhatsApp API Setup panel. Meta provides a temporary access token, a test phone number, a **Phone Number ID**, and a WhatsApp Business Account ID.
4. Add a recipient test number and complete Meta's verification prompt. Use the test number first.
5. For production, complete the WhatsApp Business Platform onboarding, register the real sender number, and create a durable System User access token with the WhatsApp messaging permissions Meta requires. Do not rely on the temporary token for production.

Official setup: [WhatsApp Cloud API getting started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started).

### Add credentials to Render

Open [Render dashboard](https://dashboard.render.com/) → VoiceBridge service → Environment. Add these server-side variables:

| Variable | Value |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta System User access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID shown in WhatsApp API Setup |
| `WHATSAPP_GRAPH_API_VERSION` | A currently supported Graph API version, e.g. `vXX.X` from Meta's docs |
| `VOICEBRIDGE_ALLOWED_USER_IDS` | Your Supabase Auth user UUID (comma-separated if multiple authorized operators) |

Never put the access token in `VITE_*`, Expo public config, or browser storage. After saving environment variables, allow Render to redeploy. Return to VoiceBridge → Connections → Check again.

**Important:** The sender allowlist is an extra protection because the WhatsApp Business number and token belong to the deployment owner. The signed-in user's Supabase UUID must be in `VOICEBRIDGE_ALLOWED_USER_IDS` before the send endpoint will authorize that account. Find the UUID in Supabase → Authentication → Users after creating your VoiceBridge account.

### Verify safely

Start with Meta's test sender and a recipient number you control. Translate a short recording, listen to the preview, confirm the recipient and consent, then send once. The API sends OGG/Opus with the Cloud API voice flag. Provider acceptance is not the same as delivery; message-status webhooks are not yet wired into the app, so check the recipient's phone and Meta logs.

## 2. Telegram Bot API

Telegram's bot API can send a native voice note with `sendVoice`. The recipient must start the bot first.

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`, follow the prompts, and copy the bot token.
3. Add the bot to a private test chat and press **Start**.
4. Obtain the numeric chat ID for that chat using a trusted Telegram bot/chat-ID tool or your own Bot API `getUpdates` call after sending the bot a message. Do not use a chat ID supplied by an unknown person.
5. In Render → VoiceBridge → Environment, add:
   - `TELEGRAM_BOT_TOKEN` = the BotFather token
   - `VOICEBRIDGE_ALLOWED_USER_IDS` = your Supabase Auth user UUID (keep the WhatsApp and Telegram owner IDs in the same comma-separated value)
6. Save and redeploy. Open VoiceBridge → Connections → Check again.

The recipient's Telegram chat ID is entered in the VoiceBridge recipient field when sending. The bot cannot initiate a conversation with a user who has never started it.

Official docs: [Telegram Bot API](https://core.telegram.org/bots/api).

## 3. Personal WhatsApp on Android

Personal WhatsApp does not offer a public API that lets a third-party website send arbitrary voice notes as the user's personal account. VoiceBridge therefore uses Android's native share sheet:

1. Finish the translation and listen to the preview.
2. Tap **Share audio**.
3. Choose WhatsApp in Android's share sheet.
4. Select the contact or group and confirm sending inside WhatsApp.

This hands the audio file to WhatsApp. WhatsApp may show it as an audio attachment rather than its native microphone-recorded voice-note bubble. VoiceBridge does not request your personal WhatsApp password, scan a QR login, or automate WhatsApp Web.

## 4. How the website connects to social platforms

The website itself is served by Render. Its browser UI calls the same-origin VoiceBridge API. The API keeps the provider tokens on the server and calls Meta or Telegram over HTTPS. Supabase handles account authentication, database records and private audio storage.

```text
Android / browser
       |
       | HTTPS + signed-in Supabase session
       v
VoiceBridge website + Render API
       |
       +---- Supabase Auth / Postgres / private Storage
       |
       +---- ElevenLabs Dubbing API
       |
       +---- Meta WhatsApp Cloud API
       |
       +---- Telegram Bot API
```

There is no need to embed a social platform's secret key in the website or to give the social platform access to your Supabase database.

## 5. What is still a manual owner step

- Create/verify the Meta Business Platform sender and add its credentials to Render.
- Create the Telegram bot and add its token to Render.
- Add the Supabase user UUID of each approved VoiceBridge sender to `VOICEBRIDGE_ALLOWED_USER_IDS`.
- Configure Meta webhook verification and delivery-status callbacks before relying on automated delivery reporting.
- Test a real short translation and send with your own test accounts. Translation uses ElevenLabs credits; do this only when you are ready to run a paid provider test.

## Troubleshooting

- **Not configured** in Connections: one or more required provider environment variables are missing, or Render has not redeployed.
- **403 sender not enabled:** the signed-in Supabase user UUID is missing from `VOICEBRIDGE_ALLOWED_USER_IDS`.
- **WhatsApp rejects the send:** check Meta app mode, token permissions/expiry, Phone Number ID, recipient test allowlist, and the WhatsApp messaging window/template requirements.
- **Telegram rejects the send:** confirm the recipient started the bot and that the chat ID is numeric and correct.
- **Website shows an old status:** open Connections and press **Check again** after the Render deployment completes.
