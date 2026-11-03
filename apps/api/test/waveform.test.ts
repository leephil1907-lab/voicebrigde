import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {waveformFromPcm16} from '../src/pilot/waveform.js';
import {sendPersonalVoicePilot, type LinkedDeviceSocket} from '../src/pilot/personal-whatsapp-transport.js';
test('PCM waveform follows actual amplitude and handles silence', () => {
  const pcm=Buffer.alloc(128); for(let i=0;i<64;i++) pcm.writeInt16LE(i*400,i*2);
  const result=waveformFromPcm16(pcm,64);
  assert.equal(result.seconds,1); assert.equal(result.waveform.length,64); assert.equal(result.waveform[0],0); assert.equal(result.waveform[63],100); assert.ok(result.waveform[10]<result.waveform[50]);
  assert.ok(waveformFromPcm16(Buffer.alloc(128),64).waveform.every(x=>x===0));
  assert.throws(()=>waveformFromPcm16(Buffer.alloc(1),64));
});
test('candidate waveform metadata is handed to the mock socket', async () => {
  const metadata=waveformFromPcm16(Buffer.from([0,0,1,0,20,0]),3); let called=false;
  const socket: LinkedDeviceSocket={async sendMessage(_jid,content){called=true; assert.deepEqual(content.waveform,metadata.waveform);assert.equal(content.seconds,1);return {key:{id:'ok'}};}};
  const result=await sendPersonalVoicePilot({policy:{enabled:true,ownerUserId:'owner'},request:{userId:'owner',jobOwnerId:'owner',jobStatus:'completed',recipient:'+2348000000000',previewConfirmed:true,recipientConsented:true},audio:Buffer.from('OggS-test'),metadata,socket});
  assert.equal(result.status,'accepted'); assert.ok(called);
});
