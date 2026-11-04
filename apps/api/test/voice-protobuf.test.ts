import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { proto } from '@whiskeysockets/baileys';
import { preparePersonalVoice } from '../src/pilot/linked-device.js';

test('real library prepares and serializes PTT audio with the supplied waveform', async () => {
  let uploaded=0;const waveform=Uint8Array.from({length:64},(_,i)=>i);
  const msg=await preparePersonalVoice(Buffer.from('OggS small mock payload'),waveform,3,async()=>{uploaded++;return {mediaUrl:'https://example.invalid/media',directPath:'/test'};});
  const decoded=proto.Message.decode(proto.Message.encode(msg).finish());
  assert.equal(uploaded,1);assert.equal(decoded.audioMessage?.ptt,true);assert.equal(decoded.audioMessage?.seconds,3);
  assert.deepEqual([...decoded.audioMessage!.waveform!],[...waveform]);assert.equal(decoded.audioMessage?.mimetype,'audio/ogg; codecs=opus');
});
