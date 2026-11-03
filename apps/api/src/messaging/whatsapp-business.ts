export type WhatsAppBusinessSendInput = {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  recipient: string;
  audio: Buffer;
  audioMimeType: string;
};

export type WhatsAppBusinessSendResult = {
  messageId: string;
  recipient: string;
  mediaId: string;
};

/**
 * Sends an already-converted OGG/Opus recording through the official
 * WhatsApp Business Cloud API. Call this only from an authenticated,
 * server-side job/route; never expose the access token to the mobile app.
 */
export async function sendWhatsAppBusinessVoiceMessage(
  input: WhatsAppBusinessSendInput,
): Promise<WhatsAppBusinessSendResult> {
  const recipient = input.recipient.replace(/[+\s()-]/g, "");
  if (!/^\d{7,15}$/.test(recipient)) {
    throw new Error("Recipient must be an international phone number in E.164 digits.");
  }
  if (!input.accessToken || !input.phoneNumberId || !input.graphApiVersion) {
    throw new Error("WhatsApp Business credentials and Graph API version are required.");
  }
  if (input.audioMimeType.toLowerCase() !== "audio/ogg; codecs=opus") {
    throw new Error("WhatsApp voice-note delivery requires OGG audio encoded with Opus.");
  }
  if (!input.audio.length) throw new Error("Translated audio is empty.");
  if (input.audio.length > 16 * 1024 * 1024) throw new Error("WhatsApp audio messages must not exceed 16 MB.");

  const baseUrl = `https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.phoneNumberId)}`;
  const upload = new FormData();
  upload.append("messaging_product", "whatsapp");
  upload.append("type", "audio/ogg");
  upload.append("file", new Blob([new Uint8Array(input.audio)], { type: input.audioMimeType }), "voicebridge.ogg");

  const mediaResponse = await fetch(`${baseUrl}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: upload,
    signal: AbortSignal.timeout(45_000),
  });
  const mediaData = await mediaResponse.json() as { id?: string; error?: { message?: string } };
  if (!mediaResponse.ok || !mediaData.id) {
    throw new Error(mediaData.error?.message || "WhatsApp Business media upload failed.");
  }

  const messageResponse = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "audio",
      audio: { id: mediaData.id, voice: true },
    }),
  });
  const messageData = await messageResponse.json() as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  const messageId = messageData.messages?.[0]?.id;
  if (!messageResponse.ok || !messageId) {
    throw new Error(messageData.error?.message || "WhatsApp Business message delivery failed.");
  }

  return { messageId, recipient, mediaId: mediaData.id };
}
