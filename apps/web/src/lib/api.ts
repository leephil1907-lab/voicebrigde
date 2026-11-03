import type { Health, HistoryJob, RuntimeConfig, TranslationJob } from "./types";

export const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); this.name = "ApiError"; }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: options.signal || AbortSignal.timeout(30_000) });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError("We couldn't reach VoiceBridge. Check your connection and try again.", "NETWORK_ERROR", 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new ApiError("Your session has expired. Sign in again to continue.", "INVALID_SESSION", 401);
    throw new ApiError(body?.message || "Something went wrong. Please try again.", body?.error || "REQUEST_FAILED", response.status);
  }
  if (body === null) throw new ApiError("The API returned an unreadable response. Check that the website is connected to the VoiceBridge API.", "INVALID_RESPONSE", 502);
  return body as T;
}

export async function fetchHealth(): Promise<Health> {
  // A degraded health check still carries useful capability flags in its JSON body.
  const response = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
  const body = await response.json();
  if (!body?.capabilities || typeof body.capabilities.authentication !== "boolean") throw new ApiError("The VoiceBridge API health endpoint is unavailable.", "API_NOT_CONNECTED", response.status);
  return body as Health;
}

export function normalizeHistory(job: HistoryJob): TranslationJob {
  return {
    id: job.id, status: job.status, stage: job.stage,
    targetLanguage: job.target_language, sourceLanguage: job.source_language,
    sourceTranscript: "", translatedTranscript: "", audioUrl: null, error: job.error,
    createdAt: job.created_at, completedAt: job.completed_at,
  };
}

export function isTranslationReady(config: RuntimeConfig | null, capabilitiesReady: boolean): boolean {
  return Boolean(config?.supabaseUrl && config.supabasePublishableKey && capabilitiesReady && config.targetLanguages.includes("es"));
}

export async function uploadTranslation(clip: Blob, filename: string, sourceLanguage: string, token: string, consent: boolean, targetLanguage = "es"): Promise<{ id: string }> {
  if (!consent) throw new ApiError("Confirm that this is your voice or that you have the speaker's permission.", "CONSENT_REQUIRED", 400);
  const form = new FormData();
  form.append("file", clip, filename);
  form.append("sourceLanguage", sourceLanguage);
  form.append("targetLanguage", targetLanguage);
  form.append("voiceConsent", "true");
  return apiRequest<{ id: string }>("/v1/voice/translate", { method: "POST", body: form, signal: AbortSignal.timeout(90_000) }, token);
}

export async function getTranslation(id: string, token: string, signal?: AbortSignal): Promise<TranslationJob> {
  return apiRequest<TranslationJob>(`/v1/voice/translations/${encodeURIComponent(id)}`, { signal }, token);
}

export async function downloadAudio(url: string): Promise<Blob> {
  const absolute = url.startsWith("http") ? url : `${API_BASE}${url}`;
  const parsed = new URL(absolute);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) throw new Error("The audio preview must use a secure HTTPS URL.");
  const response = await fetch(absolute, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error("This preview link may have expired. Reopen the voice note to get a fresh link.");
  const blob = await response.blob();
  if (!blob.size) throw new Error("The translated audio file is empty.");
  return blob;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
