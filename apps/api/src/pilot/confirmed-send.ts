import { createHmac } from 'node:crypto';
import { validatePilotSend, type PilotPolicy } from './personal-whatsapp-policy.js';

export type SendRequest = { userId:string; jobId:string; attemptId:string; recipient:string; previewConfirmed:boolean; recipientConsented:boolean };
export type Attempt = { jobId:string; recipientHash:string; state:'reserved'|'accepted'|'unknown'; messageId?:string | null };
export interface ConfirmedSendStore {
  loadOwnedCompletedAudio(userId:string, jobId:string):Promise<Buffer>;
  reserve(userId:string, attemptId:string, attempt:Attempt):Promise<{created:boolean; attempt:Attempt}>;
  finish(userId:string, attemptId:string, status:'accepted'|'unknown', messageId?:string):Promise<void>;
}
export interface VoiceSocket { status(userId:string):string; sendVoice(userId:string,recipient:string,audio:Buffer,waveform:Uint8Array,seconds:number):Promise<{status:'accepted';messageId:string}|{status:'unknown'}>; }

/** Sender is deliberately user-confirmed and idempotent by a caller-provided UUID.
 * The reserved state remains ambiguous forever if the process crashes. */
export async function confirmedSend(input:SendRequest, policy:PilotPolicy, store:ConfirmedSendStore, socket:VoiceSocket, decode:(audio:Buffer)=>Promise<{waveform:Uint8Array;seconds:number}>, fingerprintKey:Buffer):Promise<{status:'accepted'|'unknown';messageId?:string}> {
  const {recipient}=validatePilotSend(policy,{userId:input.userId,jobOwnerId:input.userId,jobStatus:'completed',recipient:input.recipient,previewConfirmed:input.previewConfirmed,recipientConsented:input.recipientConsented});
  if (socket.status(input.userId)!=='connected') throw new Error('Connect WhatsApp before sending.');
  const audio=await store.loadOwnedCompletedAudio(input.userId,input.jobId);
  const {waveform,seconds}=await decode(audio);
  if (fingerprintKey.length !== 32) throw new Error('Invalid send fingerprint key.');
  const recipientHash=createHmac('sha256',fingerprintKey).update(recipient).digest('hex');
  const reservation=await store.reserve(input.userId,input.attemptId,{jobId:input.jobId,recipientHash,state:'reserved'});
  if (reservation.attempt.jobId !== input.jobId || reservation.attempt.recipientHash !== recipientHash) throw new Error('This send request has already been used.');
  if (!reservation.created) return reservation.attempt.state === 'accepted' ? {status:'accepted',messageId:reservation.attempt.messageId || undefined} : {status:'unknown'};
  let result:{status:'accepted';messageId:string}|{status:'unknown'};
  try { result=await socket.sendVoice(input.userId,recipient,audio,waveform,seconds); } catch { result={status:'unknown'}; }
  try { await store.finish(input.userId,input.attemptId,result.status,result.status==='accepted'?result.messageId:undefined); }
  catch { return {status:'unknown'}; }
  return result;
}
