import type { SupabaseClient } from '@supabase/supabase-js';
import type { Attempt, ConfirmedSendStore } from './confirmed-send.js';
export class SupabaseSendStore implements ConfirmedSendStore {
  constructor(private readonly db:SupabaseClient,private readonly bucket:string) {}
  async loadOwnedCompletedAudio(userId:string,jobId:string):Promise<Buffer> {
    const {data:job,error}=await this.db.from('voicebridge_jobs').select('output_path,status').eq('id',jobId).eq('user_id',userId).maybeSingle();
    if(error || !job || job.status!=='completed' || !job.output_path || !job.output_path.startsWith(`${userId}/`)) throw new Error('A completed voice note from your account is required.');
    const {data,error:storageError}=await this.db.storage.from(this.bucket).download(job.output_path);
    if(storageError || !data || !data.size || data.size > 16*1024*1024) throw new Error('Could not read the translated audio.');
    return Buffer.from(await data.arrayBuffer());
  }
  async reserve(userId:string,attemptId:string,attempt:Attempt) {
    const {error}=await this.db.from('voicebridge_whatsapp_send_attempts').insert({owner_id:userId,attempt_id:attemptId,job_id:attempt.jobId,recipient_hash:attempt.recipientHash,state:'reserved'});
    if (!error) return {created:true,attempt};
    if(error.code !== '23505') throw new Error('Could not reserve the send request.');
    const {data,error:readError}=await this.db.from('voicebridge_whatsapp_send_attempts').select('job_id,recipient_hash,state,message_id').eq('owner_id',userId).eq('attempt_id',attemptId).single();
    if(readError || !data) throw new Error('Could not check the send request.');
    return {created:false,attempt:{jobId:data.job_id,recipientHash:data.recipient_hash,state:data.state,messageId:data.message_id} as Attempt};
  }
  async finish(userId:string,attemptId:string,status:'accepted'|'unknown',messageId?:string) {
    const {error}=await this.db.from('voicebridge_whatsapp_send_attempts').update({state:status,message_id:messageId || null}).eq('owner_id',userId).eq('attempt_id',attemptId).eq('state','reserved');
    if(error) throw new Error('Could not save send status.');
  }
}
