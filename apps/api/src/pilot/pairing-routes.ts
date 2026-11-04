import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authorizePilot, type PilotPolicy } from './personal-whatsapp-policy.js';
import type { LinkedDevicePairing } from './linked-device.js';
import { confirmedSend, type ConfirmedSendStore } from './confirmed-send.js';
import { decodeVoiceWaveform } from './decode-waveform.js';

type AuthUser = {id:string} | null;
type Dependencies = { policy:PilotPolicy; pairing:LinkedDevicePairing; store:ConfirmedSendStore; fingerprintKey:Buffer; authenticate:(request:FastifyRequest,reply:FastifyReply)=>Promise<unknown> };
/** This opt-in API is unavailable by default and limited to one authenticated owner. */
export function registerPairingRoutes(app:FastifyInstance, {policy,pairing,store,fingerprintKey,authenticate}:Dependencies):void {
  async function owner(request:FastifyRequest,reply:FastifyReply) {
    await authenticate(request,reply); if (reply.sent) return;
    try { authorizePilot(policy, ((request as FastifyRequest & {user:AuthUser}).user)?.id || ''); }
    catch { return reply.code(404).send({message:'Connection unavailable.'}); }
    reply.header('Cache-Control','no-store');
  }
  const user = (request:FastifyRequest) => (request as FastifyRequest & {user:AuthUser}).user!.id;
  app.get('/v1/personal-whatsapp/status',{preHandler:owner}, async request => ({status:pairing.status(user(request))}));
  app.post('/v1/personal-whatsapp/connect',{preHandler:owner,config:{rateLimit:{max:3,timeWindow:'15 minutes'}}},async (request,reply) => {
    const parsed=z.object({phone:z.string().min(7).max(30)}).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({message:'Enter your WhatsApp phone number with country code.'});
    try { await pairing.connect(user(request),parsed.data.phone); return reply.code(202).send({status:pairing.status(user(request))}); }
    catch { return reply.code(400).send({message:'Could not start linking. Check the number and connection status.'}); }
  });
  app.post('/v1/personal-whatsapp/pairing-code',{preHandler:owner,config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async request => ({code:pairing.takePairingCode(user(request))}));
  app.post('/v1/personal-whatsapp/send',{preHandler:owner,config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async (request,reply) => {
    const parsed=z.object({jobId:z.string().uuid(),attemptId:z.string().uuid(),recipient:z.string().min(7).max(30),previewConfirmed:z.literal(true),recipientConsented:z.literal(true)}).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({message:'Choose a recipient and confirm your preview and their consent.'});
    try { return await confirmedSend({...parsed.data,userId:user(request)},policy,store,pairing,decodeVoiceWaveform,fingerprintKey); }
    catch { return reply.code(400).send({message:'Could not prepare the send. Check that WhatsApp is connected and your completed note is available.'}); }
  });
  app.post('/v1/personal-whatsapp/disconnect',{preHandler:owner,config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async (request,reply) => {
    try { await pairing.disconnect(user(request)); return {status:'disconnected'}; }
    catch { return reply.code(502).send({message:'Disconnect could not be confirmed. Check Linked devices in WhatsApp and try again.'}); }
  });
}
