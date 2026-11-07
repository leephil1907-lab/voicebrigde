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
import { EncryptedAuthStore } from "./pilot/encrypted-auth-store.js";
import { SupabaseAuthRecordStore } from "./pilot/supabase-auth-record-store.js";
import { LinkedDevicePairing } from "./pilot/linked-device.js";
import { registerPairingRoutes } from "./pilot/pairing-routes.js";
import { SupabaseSendStore } from "./pilot/supabase-send-store.js";
import { canonicalAudioMime, probeAudioDuration } from "./audio.js";
import { createHash, randomUUID } from "node:crypto";
import { parsePaystackCatalog, paystackRequest, verifyPaystackWebhookSignature, type PaystackCreditPackage, type PaystackSubscriptionPlan } from "./paystack.js";
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
  MAX_TRANSLATIONS_PER_USER_PER_DAY: z.coerce.number().int().positive().max(100).default(100),
  WEB_DIST_PATH: z.string().optional(),
  PERSONAL_WHATSAPP_PILOT_ENABLED: z.enum(["true", "false"]).default("false"),
  PERSONAL_WHATSAPP_OWNER_ID: z.string().uuid().optional(),
  PERSONAL_WHATSAPP_SINGLE_INSTANCE: z.enum(["true", "false"]).default("false"),
  PERSONAL_WHATSAPP_SESSION_KEY: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_CURRENCY: z.literal("NGN").default("NGN"),
  PAYSTACK_APP_URL: z.string().url().optional(),
  PAYSTACK_CREDIT_PACKAGES_JSON: z.string().default("[]"),
  PAYSTACK_SUBSCRIPTION_PLANS_JSON: z.string().default("[]"),
}).parse(process.env);
const paystackCatalog = parsePaystackCatalog(env.PAYSTACK_CREDIT_PACKAGES_JSON, env.PAYSTACK_SUBSCRIPTION_PLANS_JSON);
const paystackAppUrl = (env.PAYSTACK_APP_URL || process.env.RENDER_EXTERNAL_URL || "https://voicebridge-81xs.onrender.com").replace(/\/$/, "");
if (!supabasePublic) throw new Error("Set SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY for API token verification.");

declare module "fastify" { interface FastifyRequest { user: AuthenticatedUser | null; rawBody: Buffer | null } }

const app = Fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  bodyLimit: env.MAX_AUDIO_BYTES + 1024 * 1024,
  trustProxy: true,
});
app.decorateRequest("user", null);
app.decorateRequest("rawBody", null);
// Preserve the exact bytes Paystack signs before parsing JSON.
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
  request.rawBody = body as Buffer;
  try { done(null, JSON.parse((body as Buffer).toString("utf8"))); }
  catch (error) { done(error as Error, undefined); }
});
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
const allowedOrigins = new Set([...env.CORS_ORIGIN.split(",").map((v) => v.trim()).filter(Boolean), process.env.RENDER_EXTERNAL_URL].filter((value): value is string => Boolean(value)));
await app.register(cors, { origin: (origin, callback) => {
  // Allow same-origin Render hosting automatically, plus explicitly configured local/custom origins.
  if (!origin || allowedOrigins.has(origin)) return callback(null, true);
  return callback(new Error("Origin is not allowed by VoiceBridge CORS."), false);
}, credentials: true });
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

// Feature is deliberately disabled by default; requires a migrated database,
// operator-managed key, a single server instance and owner-only real-device testing.
if (env.PERSONAL_WHATSAPP_PILOT_ENABLED === "true") {
  if (!env.PERSONAL_WHATSAPP_OWNER_ID || !env.PERSONAL_WHATSAPP_SESSION_KEY || env.PERSONAL_WHATSAPP_SINGLE_INSTANCE !== "true") throw new Error("Personal WhatsApp requires owner, session key and single-instance acknowledgment.");
  const policy = { enabled: true, ownerUserId: env.PERSONAL_WHATSAPP_OWNER_ID };
  const vault = new EncryptedAuthStore(new SupabaseAuthRecordStore(supabaseAdmin), policy.ownerUserId, env.PERSONAL_WHATSAPP_SESSION_KEY);
  registerPairingRoutes(app, {policy, pairing:new LinkedDevicePairing(policy,vault), store:new SupabaseSendStore(supabaseAdmin,audioBucket), fingerprintKey:Buffer.from(env.PERSONAL_WHATSAPP_SESSION_KEY,"base64"), authenticate});
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
    maxTranslationsPerDay: env.MAX_TRANSLATIONS_PER_USER_PER_DAY,
    targetLanguages: languages.map((language) => language.code),
    channels: { whatsapp: false, telegram: false },
  };
});
app.get("/v1/languages", async () => ({ items: languages }));


const webDist = env.WEB_DIST_PATH || fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(resolve(webDist, "index.html"))) {
  // @fastify/static registers the index route (GET /) when index is configured.
  // Do not add a second app.get("/") handler here.
  await app.register(staticFiles, { root: resolve(webDist), wildcard: false, index: ["index.html"] });
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
  let createdJobId: string | undefined;
  let audioDurationSeconds = 0;
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
    try { audioDurationSeconds = await probeAudioDuration(upload.buffer, upload.mimetype); if (audioDurationSeconds > env.MAX_AUDIO_SECONDS + 0.5) return reply.code(400).send({ message: `Audio must be at most ${env.MAX_AUDIO_SECONDS} seconds.` }); }
    catch { return reply.code(400).send({ message: "Could not inspect the audio. Check its format and ensure ffprobe is installed on the server." }); }
    if (!languages.some((x) => x.code === targetLanguage)) return reply.code(400).send({ error: "UNSUPPORTED_LANGUAGE", message: "Choose an enabled target language." });
    if (sourceLanguage !== "auto" && !languages.some((x) => x.code === sourceLanguage)) return reply.code(400).send({ error: "INVALID_SOURCE_LANGUAGE", message: "Choose a supported source language or auto-detection." });

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: quotaError } = await supabaseAdmin.from("voicebridge_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
    if (quotaError) throw quotaError;
    if ((count || 0) >= 20) return reply.code(429).send({ error: "USER_HOURLY_QUOTA_EXCEEDED", message: "The current limit is 20 translations per hour." });
    const id = randomUUID();
    inputPath = `${user.id}/${id}/source.${extensionFor(upload.mimetype)}`;
    const { error: storageError } = await supabaseAdmin.storage.from(audioBucket).upload(inputPath, new Blob([new Uint8Array(upload.buffer)], { type: upload.mimetype }), { contentType: upload.mimetype, upsert: false });
    if (storageError) throw storageError;
    const { data: job, error: insertError } = await supabaseAdmin.from("voicebridge_jobs").insert({
      id, user_id: user.id, status: "queued", stage: "billing_pending",
      source_language: sourceLanguage === "auto" ? null : sourceLanguage,
      target_language: targetLanguage, input_path: inputPath,
      // Keep the job invisible to workers until its credit reservation succeeds.
      available_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      voice_consented_at: new Date().toISOString(),
    }).select("id,status,target_language,created_at").single();
    if (insertError) throw insertError;
    createdJobId = job.id;
    const { data: reservation, error: reservationError } = await supabaseAdmin.rpc("reserve_voicebridge_translation", {
      p_user_id: user.id,
      p_job_id: job.id,
      p_duration_seconds: audioDurationSeconds,
    });
    if (reservationError) {
      if (String(reservationError.message || "").includes("INSUFFICIENT_CREDITS")) {
        await supabaseAdmin.from("voicebridge_jobs").delete().eq("id", job.id).eq("user_id", user.id);
        createdJobId = undefined;
        await supabaseAdmin.storage.from(audioBucket).remove([inputPath]);
        inputPath = undefined;
        return reply.code(402).send({
          error: "INSUFFICIENT_CREDITS",
          message: "You need more translation credits. Choose a credit top-up or an active subscription to continue.",
        });
      }
      throw reservationError;
    }
    if (reservation?.insufficientCredits) {
      await supabaseAdmin.from("voicebridge_jobs").delete().eq("id", job.id).eq("user_id", user.id);
      createdJobId = undefined;
      await supabaseAdmin.storage.from(audioBucket).remove([inputPath]);
      inputPath = undefined;
      return reply.code(402).send({
        error: "INSUFFICIENT_CREDITS",
        message: "You need more translation credits. Choose a credit top-up or an active subscription to continue.",
        creditsAvailable: reservation.creditsAvailable,
        creditsRequired: reservation.creditsRequired,
      });
    }
    return reply.code(202).send({
      id: job.id, status: job.status, targetLanguage: job.target_language,
      createdAt: job.created_at, creditsReserved: reservation?.credits,
      billableMinutes: reservation?.minutes, fundingSource: reservation?.fundingSource,
    });
  } catch (error) {
    if (createdJobId) await supabaseAdmin.from("voicebridge_jobs").delete().eq("id", createdJobId).eq("user_id", user.id);
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

// Account overview is read-only; payments and credit mutations remain server/webhook-only.
app.get("/v1/account/overview", { preHandler: authenticate }, async (request, reply) => {
  const userId = request.user!.id;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [subscriptionResult, creditResult, usageResult] = await Promise.all([
    supabaseAdmin.from("voicebridge_subscriptions")
      .select("plan_code,status,currency,billing_interval,current_period_start,current_period_end,cancel_at_period_end,metadata")
      .eq("user_id", userId).in("status", ["active", "trialing", "past_due"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("voicebridge_credit_accounts").select("available_credits,currency")
      .eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("voicebridge_jobs").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", since),
  ]);
  const failure = subscriptionResult.error || creditResult.error || usageResult.error;
  if (failure) {
    request.log.error({ userId, error: failure }, "Could not load account overview");
    return reply.code(503).send({ error: "ACCOUNT_OVERVIEW_UNAVAILABLE", message: "Account usage and billing data are not available yet." });
  }
  const subscription = subscriptionResult.data;
  let subscriptionMinutesIncluded = Number(subscription?.metadata?.includedMinutes || 0);
  let subscriptionMinutesUsed = 0;
  if (subscription?.current_period_start && subscription?.current_period_end && subscriptionMinutesIncluded > 0) {
    const { data: reservations, error: reservationError } = await supabaseAdmin.from("voicebridge_credit_reservations")
      .select("credits_reserved")
      .eq("user_id", userId).eq("funding_source", "subscription")
      .in("status", ["reserved", "settled"])
      .eq("period_start", subscription.current_period_start)
      .eq("period_end", subscription.current_period_end);
    if (reservationError) {
      request.log.error({ userId, error: reservationError }, "Could not load subscription usage");
      return reply.code(503).send({ error: "SUBSCRIPTION_USAGE_UNAVAILABLE", message: "Subscription usage is not available yet." });
    }
    subscriptionMinutesUsed = (reservations || []).reduce((sum, item) => sum + Number(item.credits_reserved || 0), 0) / 60;
  }
  return {
    planCode: subscription?.plan_code || "free",
    subscriptionStatus: subscription?.status || "free",
    currency: subscription?.currency || "NGN",
    billingInterval: subscription?.billing_interval || null,
    currentPeriodEnd: subscription?.current_period_end || null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
    creditsAvailable: creditResult.data?.available_credits || 0,
    subscriptionMinutesIncluded,
    subscriptionMinutesUsed,
    subscriptionMinutesRemaining: Math.max(0, subscriptionMinutesIncluded - subscriptionMinutesUsed),
    translationsLast30Days: usageResult.count || 0,
    maxTranslationsPerHour: 20,
    checkoutEnabled: Boolean(env.PAYSTACK_SECRET_KEY),
    billingProvider: "paystack",
  };
});


// Paystack billing: amounts and product entitlements are server-owned catalog entries.
// No client-supplied price, credit amount, plan code or user ID is trusted.
function publicBillingCatalog() {
  return {
    provider: "paystack",
    currency: env.PAYSTACK_CURRENCY,
    enabled: Boolean(env.PAYSTACK_SECRET_KEY && (paystackCatalog.credits.length || paystackCatalog.plans.length)),
    creditPackages: paystackCatalog.credits,
    subscriptionPlans: paystackCatalog.plans,
  };
}

app.get("/v1/billing/catalog", { preHandler: authenticate }, async () => publicBillingCatalog());

app.get("/v1/billing/payments", { preHandler: authenticate }, async (request, reply) => {
  const { data, error } = await supabaseAdmin.from("voicebridge_payments")
    .select("id,reference,payment_type,product_code,amount_minor,currency,credits_granted,status,paid_at,created_at")
    .eq("user_id", request.user!.id).order("created_at", { ascending: false }).limit(25);
  if (error) return reply.code(503).send({ error: "BILLING_HISTORY_UNAVAILABLE", message: "Payment history is not available yet." });
  return { items: data || [] };
});

app.post<{ Body: { type?: string; productCode?: string } }>("/v1/billing/checkout", { preHandler: authenticate }, async (request, reply) => {
  if (!env.PAYSTACK_SECRET_KEY) return reply.code(503).send({ error: "PAYSTACK_NOT_CONFIGURED", message: "Paystack checkout has not been configured yet." });
  const input = z.object({ type: z.enum(["credit_topup", "subscription"]), productCode: z.string().min(2).max(40) }).safeParse(request.body);
  if (!input.success) return reply.code(400).send({ error: "INVALID_CHECKOUT", message: "Choose a valid credit package or subscription plan." });
  const creditPackage: PaystackCreditPackage | undefined = input.data.type === "credit_topup"
    ? paystackCatalog.credits.find(item => item.code === input.data.productCode) : undefined;
  const subscriptionPlan: PaystackSubscriptionPlan | undefined = input.data.type === "subscription"
    ? paystackCatalog.plans.find(item => item.code === input.data.productCode) : undefined;
  if (input.data.type === "credit_topup" && !creditPackage) return reply.code(404).send({ error: "PACKAGE_NOT_FOUND", message: "This credit package is not available." });
  if (input.data.type === "subscription" && !subscriptionPlan) return reply.code(404).send({ error: "PLAN_NOT_FOUND", message: "This subscription plan is not available." });
  const user = request.user!;
  if (!user.email) return reply.code(400).send({ error: "EMAIL_REQUIRED", message: "Add and verify an email address before checkout." });
  const product = creditPackage || subscriptionPlan!;
  const reference = "VB-" + randomUUID();
  const paymentType = input.data.type;
  const { data: payment, error: insertError } = await supabaseAdmin.from("voicebridge_payments").insert({
    user_id: user.id,
    reference,
    payment_type: paymentType,
    product_code: product.code,
    plan_code: subscriptionPlan?.code || null,
    paystack_plan_code: subscriptionPlan?.paystackPlanCode || null,
    billing_interval: subscriptionPlan?.interval || null,
    billing_email: user.email,
    amount_minor: product.amountMinor,
    currency: env.PAYSTACK_CURRENCY,
    credits_granted: creditPackage?.credits || 0,
    status: "pending",
    gateway_payload: { productName: product.name },
  }).select("id").single();
  if (insertError) {
    request.log.error({ userId: user.id, error: insertError }, "Could not create Paystack payment record");
    return reply.code(503).send({ error: "PAYMENT_RECORD_FAILED", message: "Could not prepare this payment. Try again." });
  }
  try {
    const body: Record<string, unknown> = {
      email: user.email,
      amount: product.amountMinor,
      currency: env.PAYSTACK_CURRENCY,
      reference,
      callback_url: paystackAppUrl + "/?paystack=return",
      metadata: {
        voicebridge_payment_id: payment.id,
        voicebridge_user_id: user.id,
        payment_type: paymentType,
        product_code: product.code,
      },
    };
    if (subscriptionPlan) body.plan = subscriptionPlan.paystackPlanCode;
    const initialized = await paystackRequest<{ authorization_url: string; access_code: string; reference: string }>(
      env.PAYSTACK_SECRET_KEY, "/transaction/initialize", body,
    );
    if (initialized.reference !== reference || !initialized.authorization_url.startsWith("https://checkout.paystack.com/")) {
      throw new Error("Paystack returned an invalid checkout response.");
    }
    return reply.code(201).send({ authorizationUrl: initialized.authorization_url, accessCode: initialized.access_code, reference });
  } catch (error) {
    await supabaseAdmin.from("voicebridge_payments").update({ status: "failed", gateway_payload: { initializationError: error instanceof Error ? error.message : "unknown" }, updated_at: new Date().toISOString() }).eq("id", payment.id).eq("user_id", user.id);
    request.log.error({ userId: user.id, reference, error }, "Paystack transaction initialization failed");
    return reply.code(502).send({ error: "PAYSTACK_INITIALIZATION_FAILED", message: "Paystack could not start this payment. No charge was made." });
  }
});

async function verifyAndFulfillPaystackPayment(reference: string, userId?: string) {
  const paymentQuery = supabaseAdmin.from("voicebridge_payments")
    .select("id,user_id,reference,payment_type,product_code,plan_code,paystack_plan_code,billing_interval,billing_email,amount_minor,currency,credits_granted,status")
    .eq("reference", reference);
  const { data: payment, error: paymentError } = userId
    ? await paymentQuery.eq("user_id", userId).maybeSingle()
    : await paymentQuery.maybeSingle();
  if (paymentError || !payment) throw new Error("Payment reference not found.");
  if (payment.status === "success") return { status: "success", alreadyProcessed: true };
  if (payment.status !== "pending") return { status: payment.status, alreadyProcessed: false };
  if (!env.PAYSTACK_SECRET_KEY) throw new Error("Paystack is not configured.");
  const verified = await paystackRequest<{
    id: number; status: string; reference: string; amount: number; currency: string;
    customer?: { customer_code?: string; email?: string };
  }>(env.PAYSTACK_SECRET_KEY, "/transaction/verify/" + encodeURIComponent(reference));
  if (verified.status !== "success" || verified.reference !== payment.reference ||
      verified.amount !== Number(payment.amount_minor) || verified.currency !== payment.currency) {
    throw new Error("Paystack verification did not match the expected successful payment.");
  }
  const { data: fulfilled, error: fulfillError } = await supabaseAdmin.rpc("fulfill_voicebridge_paystack_payment", {
    p_reference: payment.reference,
    p_amount_minor: verified.amount,
    p_currency: verified.currency,
    p_provider_transaction_id: String(verified.id),
    p_gateway_payload: { verifiedStatus: verified.status, customerCode: verified.customer?.customer_code || null },
  });
  if (fulfillError) throw fulfillError;
  return { status: "success", alreadyProcessed: Boolean(fulfilled?.alreadyProcessed), paymentType: payment.payment_type };
}

app.post<{ Params: { reference: string } }>("/v1/billing/verify/:reference", { preHandler: authenticate }, async (request, reply) => {
  const reference = z.string().regex(/^VB-[a-f0-9-]{36}$/i).safeParse(request.params.reference);
  if (!reference.success) return reply.code(400).send({ error: "INVALID_PAYMENT_REFERENCE", message: "The payment reference is invalid." });
  try {
    const result = await verifyAndFulfillPaystackPayment(reference.data, request.user!.id);
    return result;
  } catch (error) {
    request.log.warn({ userId: request.user!.id, error }, "Paystack payment verification did not complete");
    return reply.code(409).send({ error: "PAYMENT_NOT_VERIFIED", message: error instanceof Error ? error.message : "Payment is not verified yet." });
  }
});

app.post("/webhooks/paystack", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
  const valid = verifyPaystackWebhookSignature({
    rawBody: request.rawBody || Buffer.alloc(0),
    paystackSignature: request.headers["paystack-signature"] as string | undefined,
    legacySignature: request.headers["x-paystack-signature"] as string | undefined,
    webhookSecret: env.PAYSTACK_WEBHOOK_SECRET,
    secretKey: env.PAYSTACK_SECRET_KEY,
  });
  if (!valid) return reply.code(401).send({ error: "INVALID_WEBHOOK_SIGNATURE" });
  const body = request.body as { event?: string; data?: Record<string, any> };
  const event = body?.event || "unknown";
  const data = body?.data || {};
  try {
    if (event === "charge.success" && typeof data.reference === "string") {
      // A webhook alone never grants value: independently verify the transaction with Paystack.
      const { data: knownPayment } = await supabaseAdmin.from("voicebridge_payments")
        .select("reference").eq("reference", data.reference).maybeSingle();
      if (knownPayment) {
        await verifyAndFulfillPaystackPayment(data.reference);
      } else {
        // Subsequent recurring subscription invoices have new references and no pending checkout row.
        const verified = await paystackRequest<{ status: string; reference: string; amount: number; currency: string }>(
          env.PAYSTACK_SECRET_KEY!, "/transaction/verify/" + encodeURIComponent(data.reference),
        );
        if (verified.status !== "success" || verified.reference !== data.reference || verified.currency !== env.PAYSTACK_CURRENCY) {
          throw new Error("Recurring Paystack charge could not be independently verified.");
        }
        const subscriptionCode = String(data.subscription?.subscription_code || data.subscription_code || "");
        if (subscriptionCode) {
          await supabaseAdmin.from("voicebridge_subscriptions").update({
            status: "active",
            updated_at: new Date().toISOString(),
            ...(data.next_payment_date ? { current_period_end: data.next_payment_date } : {}),
          }).eq("provider", "paystack").eq("provider_subscription_id", subscriptionCode);
        }
      }
    } else if (event === "subscription.create") {
      const subscriptionCode = String(data.subscription_code || data.subscription?.subscription_code || "");
      const customerCode = String(data.customer?.customer_code || "");
      const email = String(data.customer?.email || "").toLowerCase();
      const paystackPlanCode = String(data.plan?.plan_code || data.plan?.plan || "");
      if (subscriptionCode && email && paystackPlanCode) {
        const { data: pendingPayment } = await supabaseAdmin.from("voicebridge_payments")
          .select("user_id,plan_code,billing_interval,currency")
          .eq("payment_type", "subscription").ilike("billing_email", email)
          .eq("paystack_plan_code", paystackPlanCode).in("status", ["pending", "success"])
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (pendingPayment) {
          const { error: subscriptionError } = await supabaseAdmin.from("voicebridge_subscriptions").upsert({
            user_id: pendingPayment.user_id,
            provider: "paystack",
            provider_customer_id: customerCode || null,
            provider_subscription_id: subscriptionCode,
            plan_code: pendingPayment.plan_code,
            status: "active",
            currency: pendingPayment.currency,
            billing_interval: pendingPayment.billing_interval,
            current_period_start: data.createdAt || new Date().toISOString(),
            current_period_end: data.next_payment_date || null,
            cancel_at_period_end: false,
            metadata: { paystackPlanCode, includedMinutes: paystackCatalog.plans.find(plan => plan.paystackPlanCode === paystackPlanCode)?.includedMinutes || 0 },
            updated_at: new Date().toISOString(),
          }, { onConflict: "provider_subscription_id" });
          if (subscriptionError) throw subscriptionError;
        }
      }
    } else if (event === "subscription.not_renew" || event === "subscription.disable" || event === "invoice.payment_failed" || event === "invoice.update") {
      const subscriptionCode = String(data.subscription_code || data.subscription?.subscription_code || "");
      if (subscriptionCode) {
        const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (event === "subscription.not_renew") update.cancel_at_period_end = true;
        if (event === "subscription.disable") { update.status = "canceled"; update.cancel_at_period_end = false; }
        if (event === "invoice.payment_failed") update.status = "past_due";
        if (event === "invoice.update" && String(data.status || "").toLowerCase() === "success") {
          update.status = "active";
          update.current_period_start = new Date().toISOString();
          if (data.next_payment_date) update.current_period_end = data.next_payment_date;
        }
        const { error: updateError } = await supabaseAdmin.from("voicebridge_subscriptions").update(update)
          .eq("provider", "paystack").eq("provider_subscription_id", subscriptionCode);
        if (updateError) throw updateError;
      }
    }
    const eventKey = event + ":" + String(data.reference || data.id || data.subscription_code || data.subscription?.subscription_code || "event");
    await supabaseAdmin.from("voicebridge_billing_events").upsert({
      provider: "paystack",
      provider_event_id: eventKey,
      event_type: event,
      processed_at: new Date().toISOString(),
      payload: { event, data: { reference: data.reference || null, id: data.id || null, status: data.status || null } },
    }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });
    return reply.code(200).send({ received: true });
  } catch (error) {
    request.log.error({ event, error }, "Paystack webhook processing failed");
    return reply.code(500).send({ error: "WEBHOOK_PROCESSING_FAILED" });
  }
});

const voiceProfileConsentVersion = "2026-11-07-v1";
const voiceProfileConsentText = "I confirm that I am the speaker, or that the speaker has explicitly authorized VoiceBridge to store this voice permission record and process their voice for the selected purpose. I understand consent can be revoked for future use.";

// Voice profiles are authorization records. The current Dubbing v2 pipeline still
// uses the source recording as its voice reference; it does not promise a permanent clone.
app.get("/v1/account/voice-profiles", { preHandler: authenticate }, async (request, reply) => {
  const userId = request.user!.id;
  const { data: profiles, error } = await supabaseAdmin.from("voicebridge_voice_profiles")
    .select("id,display_name,status,consent_version,consented_at,revoked_at,created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  if (error) return reply.code(503).send({ error: "VOICE_PROFILES_UNAVAILABLE", message: "Voice permissions are not available yet." });
  const { data: consents, error: consentError } = await supabaseAdmin.from("voicebridge_voice_consents")
    .select("voice_profile_id,consent_scope,speaker_name,granted_at,revoked_at")
    .eq("user_id", userId);
  if (consentError) return reply.code(503).send({ error: "VOICE_CONSENTS_UNAVAILABLE", message: "Voice consent records could not be loaded." });
  const consentByProfile = new Map((consents || []).map(item => [item.voice_profile_id, item]));
  return { items: (profiles || []).map(profile => ({ ...profile, consent: consentByProfile.get(profile.id) || null })) };
});

app.post<{ Body: { displayName?: string; consentScope?: string; speakerName?: string } }>("/v1/account/voice-profiles", { preHandler: authenticate }, async (request, reply) => {
  const input = z.object({
    displayName: z.string().trim().min(1).max(80),
    consentScope: z.enum(["own_voice", "authorized_third_party"]),
    speakerName: z.string().trim().max(80).optional(),
  }).safeParse(request.body);
  if (!input.success) return reply.code(400).send({ error: "INVALID_VOICE_PROFILE", message: "Enter a profile name and a valid consent scope." });
  if (input.data.consentScope === "authorized_third_party" && !input.data.speakerName?.trim()) {
    return reply.code(400).send({ error: "SPEAKER_NAME_REQUIRED", message: "Enter the speaker's name for an authorized third-party voice." });
  }
  const consentTextHash = createHash("sha256").update(voiceProfileConsentText).digest("hex");
  const { data, error } = await supabaseAdmin.rpc("create_voicebridge_voice_profile", {
    p_user_id: request.user!.id,
    p_display_name: input.data.displayName,
    p_consent_scope: input.data.consentScope,
    p_speaker_name: input.data.speakerName || null,
    p_consent_version: voiceProfileConsentVersion,
    p_consent_text_hash: consentTextHash,
  });
  if (error) {
    request.log.error({ userId: request.user!.id, error }, "Could not create voice profile");
    return reply.code(503).send({ error: "VOICE_PROFILE_CREATE_FAILED", message: "Could not save this voice permission. Check the database migration and try again." });
  }
  const profile = Array.isArray(data) ? data[0] : data;
  return reply.code(201).send({ item: profile, consentText: voiceProfileConsentText, consentVersion: voiceProfileConsentVersion });
});

app.post<{ Params: { id: string } }>("/v1/account/voice-profiles/:id/revoke", { preHandler: authenticate }, async (request, reply) => {
  const id = z.string().uuid().safeParse(request.params.id);
  if (!id.success) return reply.code(400).send({ error: "INVALID_PROFILE_ID", message: "The voice profile ID is invalid." });
  const { data, error } = await supabaseAdmin.rpc("revoke_voicebridge_voice_profile", {
    p_user_id: request.user!.id,
    p_profile_id: id.data,
  });
  if (error) return reply.code(503).send({ error: "VOICE_PROFILE_REVOKE_FAILED", message: "Could not revoke this voice permission." });
  if (!data) return reply.code(404).send({ error: "VOICE_PROFILE_NOT_FOUND", message: "This voice profile does not exist or is already unavailable." });
  return { success: true, profileId: id.data, status: "revoked" };
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


app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: "NOT_FOUND", message: `Route ${request.method} ${request.url} was not found.` }));
try { await app.listen({ host: env.HOST, port: env.PORT }); }
catch (error) { app.log.error(error); process.exit(1); }
