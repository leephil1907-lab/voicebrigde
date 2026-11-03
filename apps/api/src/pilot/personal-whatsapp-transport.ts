import { validatePilotSend, type PilotPolicy, type PilotSend } from './personal-whatsapp-policy.js';

/** Transport contract for an isolated, owner-only linked-device experiment.
 * The production server does not instantiate this; a real socket, pairing,
 * authenticated endpoint and durable idempotency are still required. */
export interface LinkedDeviceSocket {
  sendMessage(jid: string, content: { audio: Buffer; mimetype: string; ptt: true }): Promise<{ key?: { id?: string | null } } | undefined>;
}
export async function sendPersonalVoicePilot(input: { policy: PilotPolicy; request: PilotSend; audio: Buffer; socket: LinkedDeviceSocket }): Promise<{ status: 'accepted'; messageId: string } | { status: 'unknown' }> {
  const { recipient } = validatePilotSend(input.policy, input.request);
  // This is a basic container signature check, not full Opus validation. The caller
  // must supply only the completed server-transcoded mono Ogg/Opus job output.
  if (input.audio.length < 4 || input.audio.length > 16 * 1024 * 1024 || input.audio.subarray(0, 4).toString('ascii') !== 'OggS') throw new Error('A supported Ogg/Opus voice note is required.');
  try {
    const result = await input.socket.sendMessage(`${recipient}@s.whatsapp.net`, { audio: input.audio, mimetype: 'audio/ogg; codecs=opus', ptt: true });
    const id = result?.key?.id;
    if (!id) return {status:'unknown'};
    return {status:'accepted',messageId:id};
  } catch {
    // A network failure may happen after the message was sent. Never auto-retry.
    return {status:'unknown'};
  }
}
