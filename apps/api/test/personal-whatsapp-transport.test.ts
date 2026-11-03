import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sendPersonalVoicePilot, type LinkedDeviceSocket } from '../src/pilot/personal-whatsapp-transport.js';
const policy = {enabled:true,ownerUserId:'owner'};
const request = {userId:'owner',jobOwnerId:'owner',jobStatus:'completed',recipient:'+234 800 000 0000',previewConfirmed:true,recipientConsented:true};
const audio = Buffer.from('OggS-experimental-audio');
test('explicit owner send supplies the native voice PTT flag to the socket once', async () => {
  let calls = 0;
  const socket: LinkedDeviceSocket = { async sendMessage(jid,content) { calls++; assert.equal(jid,'2348000000000@s.whatsapp.net'); assert.equal(content.ptt,true); assert.equal(content.mimetype,'audio/ogg; codecs=opus'); assert.equal(content.audio,audio); return {key:{id:'provider-id'}}; } };
  assert.deepEqual(await sendPersonalVoicePilot({policy,request,audio,socket}),{status:'accepted',messageId:'provider-id'}); assert.equal(calls,1);
});
test('refuses invalid requests before calling the socket and never retries an uncertain send', async () => {
  let calls=0;
  const socket: LinkedDeviceSocket = { async sendMessage() { calls++; throw new Error('Sensitive provider error'); } };
  await assert.rejects(sendPersonalVoicePilot({policy,request:{...request,userId:'other'},audio,socket}));
  await assert.rejects(sendPersonalVoicePilot({policy,request,audio:Buffer.from('not Ogg'),socket}));
  assert.equal(calls,0);
  assert.deepEqual(await sendPersonalVoicePilot({policy,request,audio,socket}),{status:'unknown'}); assert.equal(calls,1);
});
