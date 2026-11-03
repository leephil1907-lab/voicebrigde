import { DeliveryError } from "./delivery-error.js";

export async function telegramRequest<T>(method: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new DeliveryError("Telegram is not configured.", "upload", false);
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { ...init, signal: AbortSignal.timeout(45_000) });
  } catch {
    throw new DeliveryError("Telegram did not confirm the request.", method === "sendVoice" ? "send" : "upload", method !== "sendVoice");
  }
  const data = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null;
  if (!response.ok || !data?.ok) {
    const phase = method === "sendVoice" ? "send" : "upload";
    // A 4xx means Telegram rejected the send; 5xx/timeouts may be ambiguous.
    throw new DeliveryError(data?.description || `Telegram request failed (${response.status}).`, phase, phase === "upload" || response.status >= 500);
  }
  return data.result as T;
}

export async function sendTelegramVoice(input: { chatId: string; audio: Buffer; duration?: number }): Promise<{ messageId: string }> {
  if (!/^-?\d+$/.test(input.chatId)) throw new DeliveryError("Choose a connected Telegram recipient.", "upload", false);
  if (!input.audio.length || input.audio.length > 20 * 1024 * 1024) throw new DeliveryError("Telegram voice audio must be non-empty and under 20 MB.", "upload", false);
  const form = new FormData();
  form.append("chat_id", input.chatId);
  form.append("voice", new Blob([new Uint8Array(input.audio)], { type: "audio/ogg" }), "voicebridge.ogg");
  if (input.duration && Number.isFinite(input.duration)) form.append("duration", String(Math.ceil(input.duration)));
  const result = await telegramRequest<{ message_id: number; voice?: { file_id: string } }>("sendVoice", { method: "POST", body: form });
  if (!result.voice) throw new DeliveryError("Telegram accepted the upload but did not classify it as a native voice note. It was not silently replaced with a file attachment.", "send", false);
  return { messageId: String(result.message_id) };
}
