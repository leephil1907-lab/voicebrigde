import { normalizePhone } from '../audio.js';

/** Fail-closed validation for a future, explicitly enabled owner-only pilot.
 * This policy alone does not connect or send anything. */
export type PilotPolicy = { enabled: boolean; ownerUserId: string | undefined };
export type PilotSend = { userId: string; jobOwnerId: string; jobStatus: string; recipient: string; previewConfirmed: boolean; recipientConsented: boolean };
export class PilotPolicyError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'PilotPolicyError'; }
}
export function authorizePilot(policy: PilotPolicy, userId: string): void {
  if (!policy.enabled || !policy.ownerUserId || !userId || policy.ownerUserId !== userId) throw new PilotPolicyError('NOT_AVAILABLE', 'Personal WhatsApp pilot is unavailable.');
}
export function validatePilotSend(policy: PilotPolicy, input: PilotSend): { recipient: string } {
  authorizePilot(policy, input.userId);
  if (input.jobOwnerId !== input.userId || input.jobStatus !== 'completed') throw new PilotPolicyError('INVALID_NOTE', 'A completed note belonging to this account is required.');
  if (!input.previewConfirmed || !input.recipientConsented) throw new PilotPolicyError('CONFIRMATION_REQUIRED', 'Preview the note and confirm recipient consent before sending.');
  try { return { recipient: normalizePhone(input.recipient) }; }
  catch { throw new PilotPolicyError('INVALID_RECIPIENT', 'Enter a valid international phone number.'); }
}
