import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { EncryptedAuthStore, type AuthRecordStore } from '../src/pilot/encrypted-auth-store.js';
import { LinkedDevicePairing, type PairingSocket } from '../src/pilot/linked-device.js';

class MemoryStore implements AuthRecordStore {
  rows = new Map<string,string>();
  async read(owner:string,names:string[]) { return Object.fromEntries(names.flatMap(name => { const row=this.rows.get(`${owner}:${name}`); return row ? [[name,row]] : []; })); }
  async writeBatch(owner:string,values:Record<string,string|null>) { for(const [k,v] of Object.entries(values)) v === null ? this.rows.delete(`${owner}:${k}`) : this.rows.set(`${owner}:${k}`,v); }
  async clear(owner:string) { for(const key of this.rows.keys()) if(key.startsWith(`${owner}:`)) this.rows.delete(key); }
}
class FakeSocket implements PairingSocket {
  update: (x:{connection?:'connecting'|'open'|'close';qr?:string})=>void = () => {};
  credentials:()=>void=()=>{}; requests:string[]=[]; logoutCount=0; endCount=0;
  onUpdate(cb:typeof this.update) {this.update=cb;} onCredentials(cb:()=>void) {this.credentials=cb;}
  async requestPairingCode(phone:string) {this.requests.push(phone); return 'ABCD1234';}
  async logout(){this.logoutCount++;} async end(){this.endCount++;}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('owner-only phone pairing returns an expiring one-time code and disconnect clears credentials', async () => {
  const records=new MemoryStore(); const vault=new EncryptedAuthStore(records,'owner',randomBytes(32).toString('base64')); const socket=new FakeSocket();
  const pairing=new LinkedDevicePairing({enabled:true,ownerUserId:'owner'},vault,()=>socket);
  await assert.rejects(pairing.connect('other','+234 800 123 4567'));
  assert.throws(() => pairing.status('other'));
  await pairing.connect('owner','+234 800 123 4567'); assert.equal(pairing.status('owner'),'connecting');
  await assert.rejects(pairing.connect('owner','+234 800 123 4567'));
  socket.update({qr:'sensitive data not exposed'}); await tick();
  assert.deepEqual(socket.requests,['2348001234567']); assert.equal(pairing.status('owner'),'awaiting_confirmation');
  assert.equal(pairing.takePairingCode('owner'),'ABCD1234'); assert.equal(pairing.takePairingCode('owner'),null);
  socket.credentials(); await tick(); socket.update({connection:'open'}); await tick(); assert.equal(pairing.status('owner'),'connected');
  assert.equal(records.rows.size,1); await pairing.disconnect('owner');
  assert.equal(pairing.status('owner'),'disconnected'); assert.equal(socket.logoutCount,1); assert.equal(records.rows.size,0);
  socket.credentials(); await tick(); assert.equal(records.rows.size,0);
});
test('disabled pilot refuses access and invalid phone never creates a socket', async () => {
  const records=new MemoryStore(); const vault=new EncryptedAuthStore(records,'owner',randomBytes(32).toString('base64')); let created=0;
  const p = new LinkedDevicePairing({enabled:false,ownerUserId:'owner'},vault,()=>{created++; return new FakeSocket();});
  await assert.rejects(p.connect('owner','+2348001234567')); assert.equal(created,0);
  const enabled = new LinkedDevicePairing({enabled:true,ownerUserId:'owner'},vault,()=>{created++; return new FakeSocket();});
  await assert.rejects(enabled.connect('owner','123')); assert.equal(created,0);
});
test('late pairing code is discarded after disconnect', async () => {
  const records=new MemoryStore(); const vault=new EncryptedAuthStore(records,'owner',randomBytes(32).toString('base64')); const socket=new FakeSocket();
  let resolve!: (value:string)=>void; socket.requestPairingCode = () => new Promise(r=>{resolve=r;});
  const pairing=new LinkedDevicePairing({enabled:true,ownerUserId:'owner'},vault,()=>socket);
  await pairing.connect('owner','+2348001234567'); socket.update({qr:'hidden'}); await pairing.disconnect('owner'); resolve('ABCD1234'); await tick();
  assert.equal(pairing.status('owner'),'disconnected'); assert.equal(pairing.takePairingCode('owner'),null);
});
