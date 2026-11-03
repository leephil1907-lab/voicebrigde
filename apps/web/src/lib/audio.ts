export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_SECONDS = 120;
export const SILENT_PEAKS = Array.from({ length: 64 }, (_, i) => 0.08 + Math.abs(Math.sin(i * 0.73)) * 0.12);

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function audioFormat(file: Pick<File, "name" | "type">): { mime: string; extension: string } | null {
  const raw = file.type.split(";")[0].trim().toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const types: Record<string, { mime: string; extension: string }> = {
    mp3: { mime: "audio/mpeg", extension: "mp3" },
    wav: { mime: "audio/wav", extension: "wav" },
    m4a: { mime: "audio/mp4", extension: "m4a" },
    mp4: { mime: "audio/mp4", extension: "m4a" },
    aac: { mime: "audio/aac", extension: "aac" },
    ogg: { mime: "audio/ogg", extension: "ogg" },
    oga: { mime: "audio/ogg", extension: "ogg" },
    opus: { mime: "audio/ogg", extension: "ogg" },
    webm: { mime: "audio/webm", extension: "webm" },
  };
  if (types[ext]) return types[ext];
  const byMime: Record<string, { mime: string; extension: string }> = {
    "audio/mpeg": types.mp3, "audio/mp3": types.mp3,
    "audio/wav": types.wav, "audio/x-wav": types.wav, "audio/wave": types.wav,
    "audio/mp4": types.m4a, "audio/m4a": types.m4a, "audio/x-m4a": types.m4a,
    "audio/aac": types.aac, "audio/ogg": types.ogg, "application/ogg": types.ogg,
    "audio/webm": types.webm,
  };
  return byMime[raw] || null;
}

export function validateAudioFile(file: Pick<File, "name" | "type" | "size">, maxBytes = DEFAULT_MAX_BYTES): string | null {
  if (!file.size) return "This file is empty. Please choose another recording.";
  if (file.type.startsWith("video/")) return "Choose an audio-only file, not a video.";
  if (file.size > maxBytes) return `This recording is too large. Choose a file under ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  if (!audioFormat(file)) return "Choose an audio file: MP3, WAV, M4A, AAC, OGG, Opus, or WebM.";
  return null;
}

export function preferredRecordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
}

export function waveformPeaks(channel: Float32Array, count = 64): number[] {
  if (!channel.length) return [...SILENT_PEAKS];
  const block = Math.max(1, Math.floor(channel.length / count));
  const peaks = Array.from({ length: count }, (_, i) => {
    let sum = 0;
    let samples = 0;
    const end = Math.min(channel.length, (i + 1) * block);
    for (let j = i * block; j < end; j += 8) { sum += channel[j] * channel[j]; samples++; }
    return samples ? Math.sqrt(sum / samples) : 0;
  });
  const max = Math.max(...peaks, 0.001);
  return peaks.map((peak) => Math.max(0.06, peak / max));
}

export async function inspectAudio(blob: Blob): Promise<{ duration: number; peaks: number[] }> {
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser cannot inspect audio. Please use a recent Chrome, Safari, Firefox, or Edge browser.");
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("No playable audio was found in this recording.");
    return { duration: decoded.duration, peaks: waveformPeaks(decoded.getChannelData(0)) };
  } catch {
    throw new Error("We couldn't read this audio. Try recording again or choosing an MP3, WAV, or M4A file.");
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function microphoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was blocked. Allow it in your browser's site settings, then try again. If you're in an embedded preview, open the site in its own tab.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No microphone was found. Connect one, or upload an audio file instead.";
  if (name === "NotReadableError") return "Your microphone is busy. Close other apps using it and try again.";
  return "We couldn't start your microphone. Check your browser permissions, or upload an audio file instead.";
}
