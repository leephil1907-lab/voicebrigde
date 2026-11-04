import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuthRecordStore } from '../src/pilot/supabase-auth-record-store.js';

test('session writes use atomic RPC and reads and deletes are owner-scoped', async () => {
  const calls: unknown[][] = [];
  const db = { from: (table: string) => { calls.push(['from',table]); return {
    select: (fields: string) => { calls.push(['select',fields]); return { eq: (column: string, owner: string) => { calls.push(['eq',column,owner]); return {in: async (column2:string,names:string[]) => { calls.push(['in',column2,names]); return {data:[{record_name:'creds',encrypted_value:'opaque'}],error:null}; }}; } }; },
    delete: () => ({eq: async (column: string,owner: string) => {calls.push(['delete-eq',column,owner]); return {error:null};}}),
  }; }, rpc: async (fn:string, values:unknown) => {calls.push(['rpc',fn,values]); return {error:null};} };
  const store = new SupabaseAuthRecordStore(db as unknown as SupabaseClient);
  assert.deepEqual(await store.read('owner',['creds']), {creds:'opaque'});
  await store.writeBatch('owner',{creds:'encrypted'}); await store.clear('owner');
  assert.ok(calls.some(c => c[0] === 'eq' && c[2] === 'owner'));
  assert.ok(calls.some(c => c[0] === 'delete-eq' && c[2] === 'owner'));
  assert.ok(calls.some(c => c[0] === 'rpc' && c[1] === 'voicebridge_whatsapp_session_write'));
});
test('storage errors are not mistaken for empty or successful sessions', async () => {
  const db = {from: () => ({select: () => ({eq: () => ({in: async () => ({data:null,error:{message:'private details'}})})})}), rpc: async () => ({error:{message:'private details'}})};
  const store = new SupabaseAuthRecordStore(db as unknown as SupabaseClient);
  await assert.rejects(store.read('owner',['creds']), /Could not read/);
  await assert.rejects(store.writeBatch('owner',{creds:'value'}), /Could not save/);
});
