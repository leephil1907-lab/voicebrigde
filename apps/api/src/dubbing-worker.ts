import "dotenv/config";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supabaseAdmin, audioBucket } from "./supabase.js";

const apiKey = process.env.ELEVENLABS_API_KEY;
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
if (!apiKey) throw new Error("ELEVENLABS_API_KEY is required by the worker.");

type VoiceJob = {
  id: string; user_id: string; status: string; stage: string; source_language: string | null;
  target_language: string; input_path: string; output_path: string | null;
  provider_project_id: string | null; provider_language_id: string | null;
  attempts: number; max_attempts: number;
};

const workerId = `${hostname()}-${process.pid}-${randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function providerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(60_000),
    headers: { "xi-api-key": apiKey!, ...(init.headers || {}) },
  });
  const raw = await response.text();
  let data: (T & { detail?: { message?: string } | string; error?: { message?: string } }) | undefined;
  try { data = raw ? JSON.parse(raw) as T & { detail?: { message?: string } | string; error?: { message?: string } } : undefined; } catch {}
  if (!response.ok || !data) {
    const detail = typeof data?.detail === "string" ? data.detail : data?.detail?.message;
    throw new Error(detail || data?.error?.message || raw.slice(0, 500) || `ElevenLabs request failed (${response.status}).`);
  }
  return data;
}

async function convertWavToOggOpus(wav: Buffer): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "voicebridge-audio-"));
  const inputPath = join(directory, "translated.wav");
  const outputPath = join(directory, "translated.ogg");
  try {
    await writeFile(inputPath, wav);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn",
        "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "24k",
        "-vbr", "on", "-application", "voip", "-f", "ogg", outputPath,
      ]);
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-800) || "FFmpeg conversion failed.")));
    });
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function updateJob(id: string, patch: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.from("voicebridge_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("locked_by", workerId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Worker lease was lost; this worker no longer owns the job.");
}

async function runJob(job: VoiceJob) {
  const heartbeat = setInterval(async () => {
    const { error } = await supabaseAdmin.rpc("heartbeat_voicebridge_job", { p_job_id: job.id, p_worker_id: workerId });
    if (error) console.error("VoiceBridge worker heartbeat failed", job.id, error.message);
  }, 30_000);
  heartbeat.unref?.();

  try {
    let providerProjectId = job.provider_project_id;
    let providerLanguageId = job.provider_language_id;
    if (!providerProjectId) {
      await updateJob(job.id, { stage: "downloading_source" });
      const { data: sourceFile, error: downloadError } = await supabaseAdmin.storage.from(audioBucket).download(job.input_path);
      if (downloadError || !sourceFile) throw downloadError || new Error("Source recording was not found in private storage.");
      const sourceBuffer = Buffer.from(await sourceFile.arrayBuffer());
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(sourceBuffer)], { type: sourceFile.type || "audio/mp4" }), "voice-message");
      form.append("model_id", "dubbing_v2");
      form.append("reference", `VoiceBridge ${job.id}`);
      if (job.source_language) form.append("source_language", job.source_language);
      await updateJob(job.id, { stage: "creating_dubbing_project" });
      const project = await providerRequest<{ project_id: string }>("/v1/dubbing/project", { method: "POST", body: form });
      providerProjectId = project.project_id;
      await updateJob(job.id, { provider_project_id: providerProjectId, stage: "preparing_source" });
    }

    let projectStatus = "";
    for (let attempt = 0; attempt < 120; attempt++) {
      const project = await providerRequest<{ status: string; error?: { message?: string } | null }>(`/v1/dubbing/project/${encodeURIComponent(providerProjectId)}`);
      projectStatus = project.status;
      if (projectStatus === "ready") break;
      if (projectStatus === "failed") throw new Error(project.error?.message || "Dubbing provider failed to prepare the recording.");
      await updateJob(job.id, { stage: "preparing_source" });
      await sleep(3000);
    }
    if (projectStatus !== "ready") throw new Error("Source preparation timed out.");

    if (!providerLanguageId) {
      await updateJob(job.id, { stage: "creating_target_language" });
      const language = await providerRequest<{ language_id: string }>(
        `/v1/dubbing/project/${encodeURIComponent(providerProjectId)}/language`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_language: job.target_language, voice_settings: { cloning_strength: 8 } }) },
      );
      providerLanguageId = language.language_id;
      await updateJob(job.id, { provider_language_id: providerLanguageId, stage: "translating_audio" });
    }

    let languageStatus = "queued";
    let outputUrl: string | undefined;
    for (let attempt = 0; attempt < 180; attempt++) {
      const target = await providerRequest<{ status: string; outputs?: { lossless_audio?: string } | null; error?: { message?: string } | null }>(
        `/v1/dubbing/project/${encodeURIComponent(providerProjectId)}/language/${encodeURIComponent(providerLanguageId)}`,
      );
      languageStatus = target.status;
      outputUrl = target.outputs?.lossless_audio;
      if (languageStatus === "completed" && outputUrl) break;
      if (languageStatus === "failed" || languageStatus === "stale") throw new Error(target.error?.message || `Dubbing target entered ${languageStatus} state.`);
      await updateJob(job.id, { stage: "translating_audio" });
      await sleep(4000);
    }
    if (languageStatus !== "completed" || !outputUrl) throw new Error("Translated audio generation timed out.");

    await updateJob(job.id, { stage: "downloading_translation" });
    const audioResponse = await fetch(outputUrl, { signal: AbortSignal.timeout(60_000) });
    if (!audioResponse.ok) throw new Error("Could not retrieve translated audio.");
    const wav = Buffer.from(await audioResponse.arrayBuffer());
    if (!wav.length || wav.length > 100 * 1024 * 1024) throw new Error("Translated audio is empty or exceeds the 100 MB processing limit.");
    const opus = await convertWavToOggOpus(wav);
    const outputPath = `${job.user_id}/${job.id}/translated.ogg`;
    const { error: uploadError } = await supabaseAdmin.storage.from(audioBucket).upload(outputPath, opus, {
      contentType: "audio/ogg", upsert: true,
    });
    if (uploadError) throw uploadError;

    let sourceTranscript = "";
    let translatedTranscript = "";
    let sourceLanguage: string | null = job.source_language;
    try {
      const [source, target] = await Promise.all([
        providerRequest<{ language?: string | null; segments?: Array<{ text?: string }> }>(`/v1/dubbing/project/${encodeURIComponent(providerProjectId)}/transcript`),
        providerRequest<{ source_language?: string | null; segments?: Array<{ translation?: string }> }>(`/v1/dubbing/project/${encodeURIComponent(providerProjectId)}/language/${encodeURIComponent(providerLanguageId)}/transcript`),
      ]);
      sourceLanguage = source.language || target.source_language || sourceLanguage;
      sourceTranscript = (source.segments || []).map((segment) => segment.text?.trim()).filter(Boolean).join(" ");
      translatedTranscript = (target.segments || []).map((segment) => segment.translation?.trim()).filter(Boolean).join(" ");
    } catch (error) {
      console.warn("Transcript retrieval failed; audio remains available", job.id, error);
    }

    await updateJob(job.id, {
      status: "completed", stage: "completed", output_path: outputPath,
      source_language: sourceLanguage, source_transcript: sourceTranscript,
      translated_transcript: translatedTranscript, error: null,
      locked_at: null, locked_by: null, completed_at: new Date().toISOString(),
    });
    console.info("VoiceBridge job completed", job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dubbing worker failed.";
    const retry = job.attempts < job.max_attempts;
    const delaySeconds = Math.min(300, 15 * (2 ** Math.max(0, job.attempts - 1)));
    await updateJob(job.id, {
      status: retry ? "queued" : "failed",
      stage: retry ? "retry_wait" : "failed",
      error: message.slice(0, 1500),
      available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      locked_at: null, locked_by: null,
    });
    console.error("VoiceBridge job failed", job.id, { retry, message });
  } finally {
    clearInterval(heartbeat);
  }
}

async function main() {
  console.info("VoiceBridge durable worker started", workerId);
  while (true) {
    const { data, error } = await supabaseAdmin.rpc("claim_voicebridge_job", { p_worker_id: workerId });
    if (error) {
      console.error("Could not claim a VoiceBridge job", error.message);
      await sleep(5000);
      continue;
    }
    const job = (Array.isArray(data) ? data[0] : data) as VoiceJob | null;
    if (!job) {
      await sleep(2000);
      continue;
    }
    await runJob(job);
  }
}

main().catch((error) => {
  console.error("VoiceBridge worker stopped unexpectedly", error);
  process.exit(1);
});
