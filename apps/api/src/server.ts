import "dotenv/config";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart, { type MultipartFile } from "@fastify/multipart";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { understandAudio } from "./understand.js";
import { normalizePhone, isAuthorizedSender, canonicalAudioMime, probeAudioDuration } from "./audio.js";
import { sendWhatsAppBusinessVoiceMessage } from "./messaging/whatsapp-business.js";
import { sendTelegramVoice } from "./messaging/telegram.js";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, supabasePublic, audioBucket, type AuthenticatedUser } from "./supabase.js";

const env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://localhost:8081"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_AUDIO_SECONDS: z.coerce.number().int().positive().max(3600).default(120),
  WEB_DIST_PATH: z.string().optional(),
}).parse(process.env);
if (!supabasePublic) throw new Error("Set SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY for API token verification.");

declare module "fastify" { interface FastifyRequest { user: AuthenticatedUser | null } }

const app = Fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  bodyLimit: env.MAX_AUDIO_BYTES + 1024 * 1024,
  trustProxy: true,
});
app.decorateRequest("user", null);
const supabaseOrigin = new URL(env.SUPABASE_URL).origin;
const supabaseRealtime = supabaseOrigin.replace(/^http/, "ws");
await app.register(helmet, {
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:", supabaseOrigin],
      connectSrc: ["'self'", supabaseOrigin, supabaseRealtime],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: env.NODE_ENV === "production" ? [] : null,
    },
  },
});
await app.register(cors, { origin: env.CORS_ORIGIN.split(",").map((v) => v.trim()), credentials: true });
await app.register(rateLimit, { max: 30, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: env.MAX_AUDIO_BYTES, files: 1, fields: 8 } });

const languages = [
  { code: "en", name: "English", nativeName: "English" }, { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" }, { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "de", name: "German", nativeName: "Deutsch" }, { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ar", name: "Arabic", nativeName: "العربية" }, { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" }, { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "ha", name: "Hausa", nativeName: "Hausa" }, { code: "yo", name: "Yoruba", nativeName: "Yorùbá" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili" }, { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" }, { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" }, { code: "ur", name: "Urdu", nativeName: "اردو" },
];

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return reply.code(401).send({ error: "AUTH_REQUIRED", message: "Sign in to use VoiceBridge." });
  const { data, error } = await supabasePublic!.auth.getUser(token);
  if (error || !data.user) return reply.code(401).send({ error: "INVALID_SESSION", message: "Your session is invalid or expired. Sign in again." });
  request.user = { id: data.user.id, email: data.user.email || undefined };
}

async function readUpload(part: MultipartFile) {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  if (part.file.truncated) throw new Error("The uploaded audio exceeds the configured file-size limit.");
  if (!buffer.length) throw new Error("The uploaded audio file is empty.");
  return { buffer, filename: part.filename || "recording.m4a", mimetype: part.mimetype || "application/octet-stream" };
}

function extensionFor(mime: string) {
  const map: Record<string, string> = { "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg" };
  return map[mime.toLowerCase()] || "audio";
}

app.get("/health", async (_request, reply) => {
  const [{ error: databaseError }, { data: bucket, error: storageError }] = await Promise.all([
    supabaseAdmin.from("voicebridge_jobs").select("id", { head: true, count: "exact" }),
    supabaseAdmin.storage.getBucket(audioBucket),
  ]);
  const ready = !databaseError && !storageError && bucket?.public === false;
  if (!ready) reply.code(503);
  return {
    status: ready ? "ok" : "degraded",
    service: "voicebridge-api",
    capabilities: {
      authentication: Boolean(supabasePublic),
      durableJobs: !databaseError,
      privateAudioStorage: !storageError && bucket?.public === false,
      audioToAudioDubbing: Boolean(env.ELEVENLABS_API_KEY),
    },
    timestamp: new Date().toISOString(),
  };
});
// Public browser configuration. Never return the ElevenLabs key or Supabase secret.
app.get("/config", async (_request, reply) => {
  reply.header("Cache-Control", "no-store");
  return {
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY,
    maxAudioBytes: env.MAX_AUDIO_BYTES,
    maxAudioSeconds: env.MAX_AUDIO_SECONDS,
    targetLanguages: languages.map((language) => language.code),
    channels: { whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_GRAPH_API_VERSION), telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN) },
  };
});
app.get("/v1/languages", async () => ({ items: languages }));

const webDist = env.WEB_DIST_PATH || fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(resolve(webDist, "index.html"))) {
  await app.register(staticFiles, { root: resolve(webDist), wildcard: false, index: ["index.html"] });
  app.get("/", async (_request, reply) => reply.sendFile("index.html"));
  app.log.info({ webDist }, "Serving VoiceBridge web studio");
}

app.post("/v1/voice/translate", {
  preHandler: authenticate,
  config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
}, async (request, reply) => {
  if (!env.ELEVENLABS_API_KEY) return reply.code(503).send({ error: "ELEVENLABS_NOT_CONFIGURED", message: "Voice translation is temporarily unavailable." });
  const user = request.user!;
  let sourceLanguage = "auto";
  let targetLanguage = "es";
  let voiceConsent = false;
  let upload: { buffer: Buffer; filename: string; mimetype: string } | undefined;
  let inputPath: string | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (!canonicalAudioMime(part.mimetype)) return reply.code(415).send({ error: "UNSUPPORTED_MEDIA_TYPE", message: "Upload a supported audio recording." });
        upload = await readUpload(part);
        upload.mimetype = canonicalAudioMime(upload.mimetype)!;
      } else if (part.fieldname === "sourceLanguage") sourceLanguage = String(part.value);
      else if (part.fieldname === "targetLanguage") targetLanguage = String(part.value);
      else if (part.fieldname === "voiceConsent") voiceConsent = part.value === "true";
    }
    if (!upload) return reply.code(400).send({ error: "AUDIO_REQUIRED", message: "Record or select an audio message first." });
    if (!voiceConsent) return reply.code(400).send({ error: "VOICE_CONSENT_REQUIRED", message: "Confirm this is your voice or that you have the speaker's permission before translating." });
    try { if (await probeAudioDuration(upload.buffer, upload.mimetype) > env.MAX_AUDIO_SECONDS + 0.5) return reply.code(400).send({ message: `Audio must be at most ${env.MAX_AUDIO_SECONDS} seconds.` }); }
    catch { return reply.code(400).send({ message: "Could not inspect the audio. Check its format and ensure ffprobe is installed on the server." }); }
    if (!languages.some((x) => x.code === targetLanguage)) return reply.code(400).send({ error: "UNSUPPORTED_LANGUAGE", message: "Choose an enabled target language." });
    if (sourceLanguage !== "auto" && !languages.some((x) => x.code === sourceLanguage)) return reply.code(400).send({ error: "INVALID_SOURCE_LANGUAGE", message: "Choose a supported source language or auto-detection." });

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: quotaError } = await supabaseAdmin.from("voicebridge_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
    if (quotaError) throw quotaError;
    if ((count || 0) >= 20) return reply.code(429).send({ error: "USER_QUOTA_EXCEEDED", message: "The current limit is 20 translations per hour." });

    const id = randomUUID();
    inputPath = `${user.id}/${id}/source.${extensionFor(upload.mimetype)}`;
    const { error: storageError } = await supabaseAdmin.storage.from(audioBucket).upload(inputPath, new Blob([new Uint8Array(upload.buffer)], { type: upload.mimetype }), { contentType: upload.mimetype, upsert: false });
    if (storageError) throw storageError;
    const { data: job, error: insertError } = await supabaseAdmin.from("voicebridge_jobs").insert({
      id, user_id: user.id, status: "queued", stage: "queued",
      source_language: sourceLanguage === "auto" ? null : sourceLanguage,
      target_language: targetLanguage, input_path: inputPath,
      voice_consented_at: new Date().toISOString(),
    }).select("id,status,target_language,created_at").single();
    if (insertError) throw insertError;
    return reply.code(202).send({ id: job.id, status: job.status, targetLanguage: job.target_language, createdAt: job.created_at });
  } catch (error) {
    if (inputPath) await supabaseAdmin.storage.from(audioBucket).remove([inputPath]);
    request.log.error({ userId: user.id, error }, "Could not enqueue translation");
    return reply.code(502).send({ error: "VOICE_TRANSLATION_QUEUE_FAILED", message: error instanceof Error ? error.message : "Could not queue voice translation." });
  }
});

app.get<{ Params: { id: string } }>("/v1/voice/translations/:id", { preHandler: authenticate }, async (request, reply) => {
  const { data: job, error } = await supabaseAdmin.from("voicebridge_jobs")
    .select("id,status,stage,target_language,source_language,source_transcript,translated_transcript,output_path,error,created_at,updated_at,completed_at")
    .eq("id", request.params.id).eq("user_id", request.user!.id).maybeSingle();
  if (error) return reply.code(500).send({ error: "JOB_LOOKUP_FAILED", message: "Could not retrieve this translation." });
  if (!job) return reply.code(404).send({ error: "TRANSLATION_NOT_FOUND", message: "This translation does not exist or you do not have access to it." });
  let audioUrl: string | null = null;
  if (job.status === "completed" && job.output_path) {
    const { data: signed, error: signedError } = await supabaseAdmin.storage.from(audioBucket).createSignedUrl(job.output_path, 30 * 60);
    if (signedError) return reply.code(500).send({ error: "PREVIEW_URL_FAILED", message: "Could not create a private preview URL." });
    audioUrl = signed.signedUrl;
  }
  return {
    id: job.id, status: job.status, stage: job.stage, targetLanguage: job.target_language,
    sourceLanguage: job.source_language, sourceTranscript: job.source_transcript,
    translatedTranscript: job.translated_transcript, audioUrl, error: job.error,
    createdAt: job.created_at, updatedAt: job.updated_at, completedAt: job.completed_at,
  };
});

app.get("/v1/voice/translations", { preHandler: authenticate }, async (request, reply) => {
  const { data, error } = await supabaseAdmin.from("voicebridge_jobs")
    .select("id,status,stage,target_language,source_language,error,created_at,completed_at")
    .eq("user_id", request.user!.id).order("created_at", { ascending: false }).limit(50);
  if (error) return reply.code(500).send({ error: "JOB_HISTORY_FAILED", message: "Could not load translation history." });
  return { items: data || [] };
});


// Incoming audio is used only for transcription and text translation; no voice cloning.
app.post("/v1/voice/understand", { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
  if (!env.ELEVENLABS_API_KEY) return reply.code(503).send({ message: "English reading requires the ElevenLabs service to be configured." });
  try {
    let upload: Awaited<ReturnType<typeof readUpload>> | undefined;
    let consent = false;
    for await (const part of request.parts()) {
      if (part.type === "file") { if (!canonicalAudioMime(part.mimetype)) return reply.code(415).send({ message: "Choose a supported audio file." }); upload = await readUpload(part); upload.mimetype = canonicalAudioMime(upload.mimetype)!; }
      else if (part.fieldname === "processingConsent") consent = part.value === "true";
    }
    if (!upload || !consent) return reply.code(400).send({ message: "Select an audio file and confirm you have permission to process it." });
    try { if (await probeAudioDuration(upload.buffer, upload.mimetype) > env.MAX_AUDIO_SECONDS + 0.5) return reply.code(400).send({ message: `Audio must be at most ${env.MAX_AUDIO_SECONDS} seconds.` }); }
    catch { return reply.code(400).send({ message: "Could not inspect the audio. Check its format and ensure ffprobe is installed on the server." }); }
    const reading = await understandAudio({ audio: upload.buffer, mime: upload.mimetype, filename: upload.filename, apiKey: env.ELEVENLABS_API_KEY });
    return reading;
  } catch (error) { request.log.error({ error }, "Incoming audio reading failed"); return reply.code(502).send({ message: error instanceof Error ? error.message : "Could not read this voice note." }); }
});

// Server credentials are shared by this deployment, so sending is restricted to explicit owner IDs.
app.post("/v1/voice/deliver", { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
  if (!isAuthorizedSender(request.user!.id)) return reply.code(403).send({ message: "Native delivery is not enabled for this account. Ask the server owner to configure the approved sender list." });
  const schema = z.object({ jobId: z.string().uuid(), idempotencyKey: z.string().uuid(), channel: z.enum(["whatsapp_business", "telegram"]), recipient: z.string().min(1).max(40), confirmed: z.literal(true), consent: z.literal(true) });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ message: "Confirm the preview and recipient permission, then enter a valid recipient." });
  const { jobId, idempotencyKey, channel } = parsed.data;
  let recipient: string;
  try { recipient = channel === "whatsapp_business" ? normalizePhone(parsed.data.recipient) : parsed.data.recipient.trim(); if (channel === "telegram" && !/^-?\d+$/.test(recipient)) throw new Error("Enter the Telegram chat ID of someone who has started your bot."); }
  catch (error) { return reply.code(400).send({ message: (error as Error).message }); }
  if (channel === "whatsapp_business" && !(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_GRAPH_API_VERSION)) return reply.code(503).send({ message: "WhatsApp Business Cloud API is not configured." });
  if (channel === "telegram" && !process.env.TELEGRAM_BOT_TOKEN) return reply.code(503).send({ message: "Telegram bot is not configured." });
  const { data: job } = await supabaseAdmin.from("voicebridge_jobs").select("id,status,output_path").eq("id", jobId).eq("user_id", request.user!.id).maybeSingle();
  if (!job || job.status !== "completed" || !job.output_path) return reply.code(404).send({ message: "A completed voice note belonging to your account is required." });
  const now = new Date().toISOString();
  const { data: delivery, error: reservationError } = await supabaseAdmin.from("voicebridge_deliveries").insert({ user_id: request.user!.id, translation_job_id: jobId, channel, recipient, idempotency_key: idempotencyKey, status: "processing", recipient_consented_at: now, preview_confirmed_at: now, provider_attempted_at: now }).select("id").single();
  if (reservationError || !delivery) return reply.code(409).send({ message: "This send request was already submitted or delivery storage is not ready. Check before sending again." });
  try {
    const { data: file, error } = await supabaseAdmin.storage.from(audioBucket).download(job.output_path);
    if (error || !file) throw new Error("Could not retrieve the private translated audio.");
    const audio = Buffer.from(await file.arrayBuffer());
    const result = channel === "whatsapp_business" ? await sendWhatsAppBusinessVoiceMessage({ accessToken: process.env.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!, graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION!, recipient, audio, audioMimeType: "audio/ogg; codecs=opus" }) : await sendTelegramVoice({ chatId: recipient, audio });
    await supabaseAdmin.from("voicebridge_deliveries").update({ status: "accepted", provider_message_id: result.messageId, updated_at: new Date().toISOString() }).eq("id", delivery.id);
    return { status: "accepted", message: "The provider accepted your native voice message. Delivery is not yet confirmed." };
  } catch (error) {
    request.log.error({ error, deliveryId: delivery.id }, "Native voice send could not be confirmed");
    await supabaseAdmin.from("voicebridge_deliveries").update({ status: "unknown", error: "Provider result not confirmed. Check with the recipient before trying again.", updated_at: new Date().toISOString() }).eq("id", delivery.id);
    return reply.code(502).send({ message: "The send could not be confirmed. Check with the recipient before trying again to avoid duplicates." });
  }
});

app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: "NOT_FOUND", message: `Route ${request.method} ${request.url} was not found.` }));
try { await app.listen({ host: env.HOST, port: env.PORT }); }
catch (error) { app.log.error(error); process.exit(1); }
