import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart, { type MultipartFile } from "@fastify/multipart";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://localhost:8081"),
  ELEVENLABS_API_KEY: z.string().optional(),
  MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  FFMPEG_PATH: z.string().default("ffmpeg"),
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
  { code: "ha", name: "Hausa", nativeName: "Hausa" },
  { code: "yo", name: "Yoruba", nativeName: "Yorùbá" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
];
const audioJobs = new Map<string, { buffer: Buffer; contentType: string; expiresAt: number }>();
const voiceProfiles = new Map<string, { voiceId: string; name: string; createdAt: string }>();

async function readUpload(part: MultipartFile) {
  if (part.type !== "file") throw new Error("Expected an audio file.");
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) chunks.push(Buffer.from(chunk));
  const buffer = Buffer.concat(chunks);
  if (part.file.truncated) throw new Error("The uploaded audio exceeds the configured file-size limit.");
  if (!buffer.length) throw new Error("The uploaded audio file is empty.");
  return { buffer, filename: part.filename || "recording.m4a", mimetype: part.mimetype || "application/octet-stream" };
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

app.get("/health", async () => ({
  status: "ok",
  service: "voicebridge-api",
  capabilities: {
    audioToAudioDubbing: Boolean(env.ELEVENLABS_API_KEY),
    voiceCloning: Boolean(env.ELEVENLABS_API_KEY),
    whatsappVoiceNoteEncoding: true,
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

async function convertWavToOggOpus(wav: Buffer): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "voicebridge-audio-"));
  const inputPath = join(directory, "translated.wav");
  const outputPath = join(directory, "translated.ogg");
  try {
    await writeFile(inputPath, wav);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(env.FFMPEG_PATH, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
        "-vn", "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "24k", "-vbr", "on",
        "-application", "voip", "-f", "ogg", outputPath,
      ]);
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-800) || "FFmpeg audio conversion failed.")));
    });
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type DubbingJob = {
  id: string; projectId: string; languageId: string | null;
  status: "queued" | "preparing" | "processing" | "completed" | "failed";
  sourceLanguage: string | null; targetLanguage: string;
  sourceTranscript: string; translatedTranscript: string;
  audioUrl: string | null; error: string | null; createdAt: string;
};
const dubbingJobs = new Map<string, DubbingJob>();

async function elevenLabsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    ...init,
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, ...(init.headers || {}) },
  });
  const raw = await response.text();
  let data: (T & { detail?: { message?: string } | string; error?: { message?: string } }) | undefined;
  try { data = raw ? JSON.parse(raw) as T & { detail?: { message?: string } | string; error?: { message?: string } } : undefined; } catch { /* retain provider status text below */ }
  if (!response.ok || !data) {
    const detail = typeof data?.detail === "string" ? data.detail : data?.detail?.message;
    throw new Error(detail || data?.error?.message || raw.slice(0, 500) || `ElevenLabs request failed (${response.status}).`);
  }
  return data;
}

async function processDubbingJob(job: DubbingJob, upload: { buffer: Buffer; filename: string; mimetype: string }) {
  try {
    job.status = "preparing";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(upload.buffer)], { type: upload.mimetype }), upload.filename);
    form.append("model_id", "dubbing_v2");
    form.append("reference", `VoiceBridge ${job.id}`);
    if (job.sourceLanguage) form.append("source_language", job.sourceLanguage);
    const project = await elevenLabsRequest<{ project_id: string; status: string }>("/v1/dubbing/project", { method: "POST", body: form });
    job.projectId = project.project_id;

    let projectStatus = project.status;
    for (let attempt = 0; attempt < 120 && projectStatus !== "ready"; attempt++) {
      if (projectStatus === "failed") throw new Error("ElevenLabs could not prepare the source recording.");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const current = await elevenLabsRequest<{ status: string; error?: { message?: string } | null }>(`/v1/dubbing/project/${encodeURIComponent(job.projectId)}`);
      projectStatus = current.status;
      if (projectStatus === "failed") throw new Error(current.error?.message || "ElevenLabs could not prepare the source recording.");
    }
    if (projectStatus !== "ready") throw new Error("Source preparation timed out. Try a shorter or clearer recording.");

    job.status = "processing";
    const language = await elevenLabsRequest<{ language_id: string }>(
      `/v1/dubbing/project/${encodeURIComponent(job.projectId)}/language`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_language: job.targetLanguage, voice_settings: { cloning_strength: 8 } }) },
    );
    job.languageId = language.language_id;

    let languageStatus = "queued";
    let outputUrl: string | undefined;
    for (let attempt = 0; attempt < 180 && languageStatus !== "completed"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const current = await elevenLabsRequest<{ status: string; outputs?: { lossless_audio?: string } | null; error?: { message?: string } | null }>(
        `/v1/dubbing/project/${encodeURIComponent(job.projectId)}/language/${encodeURIComponent(job.languageId)}`,
      );
      languageStatus = current.status;
      outputUrl = current.outputs?.lossless_audio;
      if (languageStatus === "failed") throw new Error(current.error?.message || "Translated voice generation failed.");
      if (languageStatus === "stale") throw new Error("The translation became outdated before audio was downloaded. Please try again.");
    }
    if (languageStatus !== "completed" || !outputUrl) throw new Error("Voice generation timed out. Please try again.");

    const audioResponse = await fetch(outputUrl, { signal: AbortSignal.timeout(60_000) });
    if (!audioResponse.ok) throw new Error("Could not retrieve the completed translated audio.");
    const wavAudio = Buffer.from(await audioResponse.arrayBuffer());
    if (!wavAudio.length || wavAudio.length > 100 * 1024 * 1024) throw new Error("The generated audio is empty or exceeds the 100 MB processing limit.");
    const voiceNoteAudio = await convertWavToOggOpus(wavAudio);
    try {
      const [sourceTranscript, targetTranscript] = await Promise.all([
        elevenLabsRequest<{ language?: string | null; segments?: Array<{ text?: string }> }>(`/v1/dubbing/project/${encodeURIComponent(job.projectId)}/transcript`),
        elevenLabsRequest<{ source_language?: string | null; segments?: Array<{ translation?: string }> }>(`/v1/dubbing/project/${encodeURIComponent(job.projectId)}/language/${encodeURIComponent(job.languageId!)}/transcript`),
      ]);
      job.sourceLanguage = sourceTranscript.language || targetTranscript.source_language || job.sourceLanguage;
      job.sourceTranscript = (sourceTranscript.segments || []).map((segment) => segment.text?.trim()).filter(Boolean).join(" ");
      job.translatedTranscript = (targetTranscript.segments || []).map((segment) => segment.translation?.trim()).filter(Boolean).join(" ");
    } catch (transcriptError) {
      app.log.warn({ jobId: job.id, error: transcriptError }, "Transcript retrieval failed; audio preview remains available");
    }
    const previewId = randomUUID();
    audioJobs.set(previewId, { buffer: voiceNoteAudio, contentType: "audio/ogg; codecs=opus", expiresAt: Date.now() + 30 * 60 * 1000 });
    for (const [key, item] of audioJobs) if (item.expiresAt <= Date.now()) audioJobs.delete(key);
    job.audioUrl = `/v1/voice/previews/${previewId}`;
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Voice dubbing failed.";
    app.log.error({ jobId: job.id, error }, "VoiceBridge dubbing job failed");
  }
}

app.post("/v1/voice/translate", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
  if (!env.ELEVENLABS_API_KEY) return reply.code(503).send({ error: "ELEVENLABS_NOT_CONFIGURED", message: "Add ELEVENLABS_API_KEY to the API environment." });
  try {
    let sourceLanguage = "auto";
    let targetLanguage = "es";
    let upload: { buffer: Buffer; filename: string; mimetype: string } | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") upload = await readUpload(part);
      else if (part.fieldname === "sourceLanguage") sourceLanguage = String(part.value);
      else if (part.fieldname === "targetLanguage") targetLanguage = String(part.value);
    }
    if (!upload) return reply.code(400).send({ error: "AUDIO_REQUIRED", message: "Record or select an audio message first." });
    if (!upload.mimetype.startsWith("audio/")) return reply.code(415).send({ error: "UNSUPPORTED_MEDIA_TYPE", message: "Upload an audio recording in a supported audio format." });
    if (!languages.some((language) => language.code === targetLanguage)) return reply.code(400).send({ error: "UNSUPPORTED_LANGUAGE", message: "Choose a language currently enabled in VoiceBridge." });
    const now = Date.now();
    for (const [jobId, existing] of dubbingJobs) if (now - Date.parse(existing.createdAt) > 24 * 60 * 60 * 1000) dubbingJobs.delete(jobId);
    while (dubbingJobs.size >= 500) {
      const oldestId = dubbingJobs.keys().next().value;
      if (!oldestId) break;
      dubbingJobs.delete(oldestId);
    }
    const id = randomUUID();
    const job: DubbingJob = {
      id, projectId: "", languageId: null, status: "queued",
      sourceLanguage: sourceLanguage === "auto" ? null : sourceLanguage,
      targetLanguage, sourceTranscript: "", translatedTranscript: "",
      audioUrl: null, error: null, createdAt: new Date().toISOString(),
    };
    dubbingJobs.set(id, job);
    void processDubbingJob(job, upload);
    return reply.code(202).send({ id, status: job.status, targetLanguage, pollUrl: `/v1/voice/translations/${id}` });
  } catch (error) {
    request.log.error(error);
    return reply.code(502).send({ error: "VOICE_TRANSLATION_FAILED", message: error instanceof Error ? error.message : "Could not start voice translation." });
  }
});

app.get<{ Params: { id: string } }>("/v1/voice/translations/:id", async (request, reply) => {
  const job = dubbingJobs.get(request.params.id);
  if (!job) return reply.code(404).send({ error: "TRANSLATION_NOT_FOUND", message: "This translation job does not exist or has expired." });
  return { id: job.id, status: job.status, targetLanguage: job.targetLanguage, sourceLanguage: job.sourceLanguage, sourceTranscript: job.sourceTranscript, translatedTranscript: job.translatedTranscript, audioUrl: job.audioUrl, error: job.error, createdAt: job.createdAt };
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
