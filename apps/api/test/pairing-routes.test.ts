import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import Fastify, {type FastifyRequest, type FastifyReply} from 'fastify';
import { registerPairingRoutes } from '../src/pilot/pairing-routes.js';
import type { LinkedDevicePairing } from '../src/pilot/linked-device.js';

test('pairing endpoints require sign-in and owner, never expose codes to another account', async () => {
  const app=Fastify(); app.decorateRequest('user',null); let starts=0, codeReads=0;
  const pairing={status:()=> 'connecting', connect:async()=>{starts++;}, takePairingCode:()=>{codeReads++;return 'ABCD1234';},disconnect:async()=>{}} as unknown as LinkedDevicePairing;
  const authenticate=async (req:FastifyRequest, reply:FastifyReply) => { const id=req.headers['x-test-user']; if (!id) return reply.code(401).send({message:'Sign in'}); (req as FastifyRequest & {user:{id:string}}).user={id:String(id)}; };
  registerPairingRoutes(app,{policy:{enabled:true,ownerUserId:'owner'},pairing,store:{} as never,fingerprintKey:Buffer.alloc(32),authenticate});
  assert.equal((await app.inject({method:'GET',url:'/v1/personal-whatsapp/status'})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/v1/personal-whatsapp/pairing-code',headers:{'x-test-user':'other'}})).statusCode,404); assert.equal(codeReads,0);
  assert.equal((await app.inject({method:'POST',url:'/v1/personal-whatsapp/connect',headers:{'x-test-user':'owner'},payload:{phone:'x'}})).statusCode,400); assert.equal(starts,0);
  const start=await app.inject({method:'POST',url:'/v1/personal-whatsapp/connect',headers:{'x-test-user':'owner'},payload:{phone:'+2348001234567'}});
  assert.equal(start.statusCode,202); assert.equal(starts,1); assert.equal(start.headers['cache-control'],'no-store');
  const code=await app.inject({method:'POST',url:'/v1/personal-whatsapp/pairing-code',headers:{'x-test-user':'owner'}});
  assert.equal(code.json().code,'ABCD1234'); assert.equal(code.headers['cache-control'],'no-store');
  await app.close();
});
