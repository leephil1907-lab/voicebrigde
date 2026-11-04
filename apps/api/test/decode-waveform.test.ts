import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { decodeVoiceWaveform } from '../src/pilot/decode-waveform.js';
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const available = spawnSync(ffmpeg, ['-version']).status === 0;

test('rejects invalid audio before invoking the decoder', async () => {
  await assert.rejects(decodeVoiceWaveform(Buffer.from('not ogg'), ffmpeg), /Expected an Ogg/);
});
test('extracts waveform from a real encoded Ogg/Opus recording', { skip: !available }, async () => {
  const result = spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ac','1','-ar','48000','-c:a','libopus','-f','ogg','pipe:1'], {maxBuffer:1024*1024});
  assert.equal(result.status, 0, result.stderr.toString());
  const output = await decodeVoiceWaveform(result.stdout, ffmpeg);
  assert.equal(output.waveform.length, 64); assert.equal(output.seconds, 1);
  assert.ok(output.waveform.some(n => n > 0));
});
test('uses the recording amplitude rather than a fabricated pattern', { skip: !available }, async () => {
  const result = spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-f','lavfi','-i',"aevalsrc=if(lt(t\\,0.5)\\,0\\,0.5*sin(2*PI*440*t)):s=48000:d=1",'-ac','1','-c:a','libopus','-f','ogg','pipe:1'], {maxBuffer:1024*1024});
  assert.equal(result.status, 0, result.stderr.toString());
  const {waveform} = await decodeVoiceWaveform(result.stdout, ffmpeg);
  assert.ok(Math.max(...waveform.slice(0,20)) < 10); assert.ok(Math.max(...waveform.slice(40,60)) > 50);
});
test('rejects corrupt Ogg payloads', { skip: !available }, async () => {
  await assert.rejects(decodeVoiceWaveform(Buffer.from('OggSbad-data'), ffmpeg), /decode/);
});
