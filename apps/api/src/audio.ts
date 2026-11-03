import { spawn } from "node:child_process";

export const AUDIO_MIME_TYPES: Record<string, string> = {
  "audio/mp4": "audio/mp4", "audio/m4a": "audio/mp4", "audio/x-m4a": "audio/mp4",
  "audio/aac": "audio/aac", "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg",
  "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav",
  "audio/webm": "audio/webm", "audio/ogg": "audio/ogg", "application/ogg": "audio/ogg",
};

export function canonicalAudioMime(value: string): string | null {
  return AUDIO_MIME_TYPES[value.split(";")[0].trim().toLowerCase()] || null;
}

export function audioExtension(mime: string): string {
  const map: Record<string, string> = { "audio/mp4": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg" };
  return map[canonicalAudioMime(mime) || ""] || "audio";
}

export async function probeAudioDuration(buffer: Buffer, mime: string, ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg"): Promise<number> {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "voicebridge-probe-"));
  const path = join(directory, `audio.${audioExtension(mime)}`);
  try {
    await writeFile(path, buffer, { mode: 0o600 });
    const ffprobe = process.env.FFPROBE_PATH || ffmpegPath.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
    async function run(command: string, args: string[]): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Audio inspection timed out.")); }, 20_000);
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > 100_000) child.kill("SIGKILL"); });
        child.once("error", (error) => { clearTimeout(timeout); reject(error); });
        child.once("close", (code) => { clearTimeout(timeout); code === 0 ? resolve(stdout) : reject(new Error("Could not inspect this audio file.")); });
      });
    }
    const output = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path]);
    const parsed = JSON.parse(output) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
    if (!parsed.streams?.some((stream) => stream.codec_type === "audio")) throw new Error("The recording has no audio stream.");
    const duration = Number(parsed.format?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
    // MediaRecorder WebM files often omit container duration. Decode to a null sink
    // and read FFmpeg's final timestamp. No provider is called until this succeeds.
    const progress = await run(ffmpegPath, ["-nostdin", "-v", "error", "-i", path, "-map", "0:a:0", "-vn", "-f", "null", "-", "-progress", "pipe:1", "-nostats"]);
    const matches = [...progress.matchAll(/^out_time_us=(\d+)$/gm)];
    const seconds = Number(matches.at(-1)?.[1]) / 1_000_000;
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("The recording has no readable audio duration.");
    return seconds;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function normalizePhone(value: string): string {
  const normalized = value.replace(/[\s()+-]/g, "");
  if (!/^[1-9]\d{6,14}$/.test(normalized)) throw new Error("Enter the recipient's international phone number, including country code.");
  return normalized;
}

export function isAuthorizedSender(userId: string): boolean {
  return (process.env.VOICEBRIDGE_ALLOWED_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}
