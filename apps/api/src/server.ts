import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://localhost:8081"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OPENAI_TRANSLATION_MODEL: z.string().default("gpt-4o-mini"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().default("eleven_multilingual_v2"),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
});
const env = envSchema.parse(process.env);
const app = Fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  bodyLimit: env.MAX_AUDIO_BYTES + 1024 * 1024,
  trustProxy: true,
});

await app.register(helmet);
await app.register(cors, {
  origin: env.CORS_ORIGIN.split(",").map((value) => value.trim()),
  credentials: true,
});
await app.register(rateLimit, { max: 30, timeWindow: "1 minute" });
await app.register(multipart, {
  limits: { fileSize: env.MAX_AUDIO_BYTES, files: 1, fields: 8 },
});

const languages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
];
const audioJobs = new Map<string, { buffer: Buffer; contentType: string; expiresAt: number }>();
const voiceProfiles = new Map<string, { voiceId: string; name: string; createdAt: string }>();

function requireProviderKeys(reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  if (!env.OPENAI_API_KEY) {
    reply.code(503).send({ error: "OPENAI_NOT_CONFIGURED", message: "Add OPENAI_API_KEY to the API environment." });
    return false;
  }
  if (!env.ELEVENLABS_API_KEY) {
    reply.code(503).send({ error: "ELEVENLABS_NOT_CONFIGURED", message: "Add ELEVENLABS_API_KEY to the API environment." });
    return false;
  }
  return true;
}

async function readUpload(part: Awaited<ReturnType<typeof app.parts>> extends AsyncIterable<infer T> ? T : never) {
  if (part.type !== "file") throw new Error("Expected an audio file.");
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error("The uploaded audio file is empty.");
  return { buffer, filename: part.filename || "recording.m4a", mimetype: part.mimetype || "application/octet-stream" };
}

async function openAiTranscribe(buffer: Buffer, filename: string, mimetype: string, language: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimetype }), filename);
  form.append("model", env.OPENAI_TRANSCRIPTION_MODEL);
  if (language !== "auto") form.append("language", language);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  const data = await response.json() as { text?: string; error?: { message?: string } };
  if (!response.ok || !data.text) throw new Error(data.error?.message || "Transcription failed.");
  return data.text;
}

async function openAiTranslate(text: string, sourceLanguage: string, targetLanguage: string) {
  const sourceName = languages.find((item) => item.code === sourceLanguage)?.name ?? sourceLanguage;
  const targetName = languages.find((item) => item.code === targetLanguage)?.name ?? targetLanguage;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_TRANSLATION_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: `Translate the user's message from ${sourceName} to ${targetName}. Preserve meaning, tone, names, numbers and intent. Return only the translated text; do not explain.` },
        { role: "user", content: text },
      ],
    }),
  });
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  const translated = data.choices?.[0]?.message?.content?.trim();
  if (!response.ok || !translated) throw new Error(data.error?.message || "Translation failed.");
  return translated;
}

async function elevenLabsClone(buffer: Buffer, filename: string, mimetype: string, name: string) {
  const form = new FormData();
  form.append("name", name);
  form.append("files", new Blob([new Uint8Array(buffer)], { type: mimetype }), filename);
  form.append("remove_background_noise", "true");
  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY! },
    body: form,
  });
  const data = await response.json() as { voice_id?: string; detail?: { message?: string } | string };
  if (!response.ok || !data.voice_id) {
    const detail = typeof data.detail === "string" ? data.detail : data.detail?.message;
    throw new Error(detail || "Voice profile creation failed.");
  }
  return data.voice_id;
}

async function elevenLabsSpeak(text: string, voiceId: string) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: env.ELEVENLABS_MODEL_ID,
      voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 500) || "Voice generation failed.");
  }
  return Buffer.from(await response.arrayBuffer());
}

app.get("/health", async () => ({
  status: "ok",
  service: "voicebridge-api",
  capabilities: {
    transcription: Boolean(env.OPENAI_API_KEY),
    translation: Boolean(env.OPENAI_API_KEY),
    voiceCloning: Boolean(env.ELEVENLABS_API_KEY),
    audioPreview: true,
  },
  timestamp: new Date().toISOString(),
}));

app.get("/v1/languages", async () => ({ items: languages }));

app.post("/v1/voice-profiles", async (request, reply) => {
  if (!env.ELEVENLABS_API_KEY) return reply.code(503).send({ error: "ELEVENLABS_NOT_CONFIGURED", message: "Add ELEVENLABS_API_KEY to the API environment." });
  try {
    let name = "My Voice";
    let consent = false;
    let upload: { buffer: Buffer; filename: string; mimetype: string } | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") upload = await readUpload(part);
      else if (part.fieldname === "name") name = String(part.value).trim().slice(0, 80) || name;
      else if (part.fieldname === "consent") consent = String(part.value) === "true";
    }
    if (!consent) return reply.code(400).send({ error: "VOICE_CONSENT_REQUIRED", message: "Confirm that this is your voice or that you have explicit permission to clone it." });
    if (!upload) return reply.code(400).send({ error: "AUDIO_REQUIRED", message: "Upload a clear voice sample." });
    const voiceId = await elevenLabsClone(upload.buffer, upload.filename, upload.mimetype, name);
    const id = randomUUID();
    voiceProfiles.set(id, { voiceId, name, createdAt: new Date().toISOString() });
    return reply.code(201).send({ id, voiceId, name, createdAt: voiceProfiles.get(id)!.createdAt });
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({ error: "VOICE_PROFILE_FAILED", message: error instanceof Error ? error.message : "Voice profile creation failed." });
  }
});

app.post("/v1/voice/translate", async (request, reply) => {
  if (!requireProviderKeys(reply)) return;
  try {
    let sourceLanguage = "auto";
    let targetLanguage = "es";
    let voiceId = "";
    let upload: { buffer: Buffer; filename: string; mimetype: string } | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") upload = await readUpload(part);
      else if (part.fieldname === "sourceLanguage") sourceLanguage = String(part.value);
      else if (part.fieldname === "targetLanguage") targetLanguage = String(part.value);
      else if (part.fieldname === "voiceId") voiceId = String(part.value);
    }
    if (!upload) return reply.code(400).send({ error: "AUDIO_REQUIRED", message: "Record or select an audio message first." });
    if (!languages.some((item) => item.code === targetLanguage)) return reply.code(400).send({ error: "UNSUPPORTED_LANGUAGE", message: "Choose a supported target language." });
    if (!voiceId) return reply.code(400).send({ error: "VOICE_PROFILE_REQUIRED", message: "Create your authorized voice profile before generating speech." });

    const transcript = await openAiTranscribe(upload.buffer, upload.filename, upload.mimetype, sourceLanguage);
    const translatedText = await openAiTranslate(transcript, sourceLanguage === "auto" ? "en" : sourceLanguage, targetLanguage);
    const generatedAudio = await elevenLabsSpeak(translatedText, voiceId);
    const id = randomUUID();
    audioJobs.set(id, { buffer: generatedAudio, contentType: "audio/mpeg", expiresAt: Date.now() + 30 * 60 * 1000 });
    return reply.send({
      id,
      sourceLanguage,
      targetLanguage,
      transcript,
      translatedText,
      audioUrl: `/v1/voice/previews/${id}`,
      audioMimeType: "audio/mpeg",
      expiresInSeconds: 1800,
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({ error: "VOICE_TRANSLATION_FAILED", message: error instanceof Error ? error.message : "Voice translation failed." });
  }
});

app.get<{ Params: { id: string } }>("/v1/voice/previews/:id", async (request, reply) => {
  const item = audioJobs.get(request.params.id);
  if (!item || item.expiresAt < Date.now()) {
    audioJobs.delete(request.params.id);
    return reply.code(404).send({ error: "PREVIEW_EXPIRED", message: "This preview has expired. Generate it again." });
  }
  return reply.header("Cache-Control", "private, no-store").type(item.contentType).send(item.buffer);
});

app.setNotFoundHandler((request, reply) => reply.code(404).send({
  error: "NOT_FOUND",
  message: `Route ${request.method} ${request.url} was not found.`,
}));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
