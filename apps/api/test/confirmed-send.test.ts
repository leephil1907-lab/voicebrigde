import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { confirmedSend, type Attempt, type ConfirmedSendStore, type SendRequest } from '../src/pilot/confirmed-send.js';

class Store implements ConfirmedSendStore {
  rows=new Map<string,Attempt>(); loads=0;
  async loadOwnedCompletedAudio() {this.loads++;return Buffer.from('OggSfake');}
  async reserve(_u:string,id:string,a:Attempt) {const previous=this.rows.get(id);if(previous)return {created:false,attempt:previous};this.rows.set(id,{...a});return {created:true,attempt:a};}
  async finish(_u:string,id:string,state:'accepted'|'unknown',messageId?:string) {Object.assign(this.rows.get(id)!,{state,messageId});}
}
const input:SendRequest={userId:'owner',jobId:'job',attemptId:'attempt',recipient:'+2348001234567',previewConfirmed:true,recipientConsented:true};
const policy={enabled:true,ownerUserId:'owner'}; const decode=async () => ({waveform:new Uint8Array(64),seconds:1}); const key=randomBytes(32);
test('requires preview, consent and owner before reading audio or sending',async()=>{
  const store=new Store(); let sends=0; const sock={status:()=> 'connected',sendVoice:async()=>{sends++;return {status:'accepted' as const,messageId:'id'};}};
  for(const change of [{previewConfirmed:false},{recipientConsented:false},{userId:'other'}]) await assert.rejects(confirmedSend({...input,...change},policy,store,sock,decode,key));
  assert.equal(store.loads,0);assert.equal(sends,0);
});
test('reserves before send and prevents a duplicate relay for the same attempt',async()=>{
  const store=new Store();let sends=0;const sock={status:()=> 'connected',sendVoice:async()=>{sends++;assert.equal(store.rows.get('attempt')?.state,'reserved');return {status:'accepted' as const,messageId:'id'};}};
  assert.deepEqual(await confirmedSend(input,policy,store,sock,decode,key),{status:'accepted',messageId:'id'});
  assert.deepEqual(await confirmedSend(input,policy,store,sock,decode,key),{status:'accepted',messageId:'id'});assert.equal(sends,1);
  await assert.rejects(confirmedSend({...input,recipient:'+2348000000000'},policy,store,sock,decode,key));assert.equal(sends,1);
});
test('never retries an ambiguous send, even if the provider throws',async()=>{
  const store=new Store();let sends=0;const sock={status:()=> 'connected',sendVoice:async()=>{sends++;throw new Error('network');}};
  assert.deepEqual(await confirmedSend(input,policy,store,sock,decode,key),{status:'unknown'});
  assert.deepEqual(await confirmedSend(input,policy,store,sock,decode,key),{status:'unknown'});assert.equal(sends,1);
});
