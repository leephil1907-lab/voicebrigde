import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { EncryptedAuthStore, type AuthRecordStore } from '../src/pilot/encrypted-auth-store.js';

class MemoryStore implements AuthRecordStore {
  rows = new Map<string,string>();
  async read(owner: string, names: string[]) { const result: Record<string,string> = {}; for (const name of names) { const value = this.rows.get(`${owner}:${name}`); if (value) result[name] = value; } return result; }
  async writeBatch(owner: string, values: Record<string,string|null>) { for (const [name,value] of Object.entries(values)) value === null ? this.rows.delete(`${owner}:${name}`) : this.rows.set(`${owner}:${name}`,value); }
  async clear(owner: string) { for (const key of this.rows.keys()) if (key.startsWith(`${owner}:`)) this.rows.delete(key); }
}
test('encrypts credentials and signal keys, roundtrips bytes, and clears the owner', async () => {
  const store = new MemoryStore(); const key = randomBytes(32).toString('base64'); const vault = new EncryptedAuthStore(store, 'owner', key);
  const session = await vault.load(); await session.saveCreds(); await session.state.keys.set({ session: { contact: Buffer.from('secret-session') } });
  assert.equal(JSON.stringify([...store.rows.values()]).includes('secret-session'), false);
  const reloaded = await vault.load(); const stored = await reloaded.state.keys.get('session', ['contact']);
  assert.equal(Buffer.from(stored.contact).toString(), 'secret-session');
  assert.deepEqual(reloaded.state.creds.registrationId, session.state.creds.registrationId);
  await reloaded.state.keys.set({session:{contact:null}}); assert.deepEqual(await reloaded.state.keys.get('session',['contact']), {});
  await reloaded.state.keys.clear!(); assert.equal(store.rows.size, 0);
});
test('fails closed on wrong key, modified ciphertext or cross-owner record replay', async () => {
  const store = new MemoryStore(); const key = randomBytes(32).toString('base64'); const vault = new EncryptedAuthStore(store, 'owner', key);
  await (await vault.load()).saveCreds(); const ciphertext = store.rows.get('owner:creds')!;
  await assert.rejects(new EncryptedAuthStore(store, 'owner', randomBytes(32).toString('base64')).load());
  store.rows.set('other:creds', ciphertext); await assert.rejects(new EncryptedAuthStore(store, 'other', key).load());
  const data = JSON.parse(ciphertext); data.tag = Buffer.alloc(16).toString('base64'); store.rows.set('owner:creds', JSON.stringify(data));
  await assert.rejects(vault.load());
  assert.throws(() => new EncryptedAuthStore(store,'owner','invalid'), /32-byte/);
});

test('a disconnected session cannot resurrect credentials', async () => {
  const store = new MemoryStore(); const vault = new EncryptedAuthStore(store,'owner',randomBytes(32).toString('base64'));
  const old=await vault.load(); await old.saveCreds(); await vault.clear();
  await assert.rejects(old.saveCreds(),/disconnected/);
  await assert.rejects(old.state.keys.set({session:{x:Buffer.from('bad')}}),/disconnected/);
  assert.equal(store.rows.size,0);
});
