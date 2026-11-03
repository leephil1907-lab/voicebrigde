import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalAudioMime, normalizePhone, probeAudioDuration } from '../src/audio.js';
import { understandAudio } from '../src/understand.js';
import { sendWhatsAppBusinessVoiceMessage } from '../src/messaging/whatsapp-business.js';

const result = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const fakeFetch = (response: Response, inspect?: (init?: RequestInit) => void): typeof fetch => async (_url, init) => { inspect?.(init); return response; };

test('text-only understanding requests English edit and returns original and translated text', async () => {
  const fetchImpl = fakeFetch(result({ text: 'Bonjour', language_code: 'fra', edited_transcript: { kind: 'transcript', text: 'Hello' } }), init => {
    const form = init?.body as FormData;
    assert.equal(form.get('model_id'), 'scribe_v2');
    assert.match(String(form.get('transcript_edit')), /English/);
    assert.equal(new Headers(init?.headers).get('xi-api-key'), 'test-key');
    assert.equal(form.has('voice_id'), false);
  });
  assert.deepEqual(await understandAudio({ audio: Buffer.from('fake'), mime: 'audio/ogg', filename: 'note.ogg', apiKey: 'test-key', fetchImpl }), { sourceText: 'Bonjour', englishText: 'Hello', sourceLanguage: 'fra', translationStatus: 'completed' });
});

test('failed English edit never labels foreign original as English', async () => {
  const fetchImpl = fakeFetch(result({ text: 'Bonjour', language_code: 'fra', edited_transcript: { kind: 'error', message: 'unavailable' } }));
  const output = await understandAudio({ audio: Buffer.from('fake'), mime: 'audio/ogg', filename: 'note.ogg', apiKey: 'test-key', fetchImpl });
  assert.equal(output.translationStatus, 'unavailable'); assert.equal(output.englishText, ''); assert.equal(output.sourceText, 'Bonjour');
});

test('English transcript remains readable if edit fails', async () => {
  const fetchImpl = fakeFetch(result({ text: 'Hello', language_code: 'eng', edited_transcript: { kind: 'error' } }));
  const output = await understandAudio({ audio: Buffer.from('fake'), mime: 'audio/ogg', filename: 'note.ogg', apiKey: 'test-key', fetchImpl });
  assert.equal(output.englishText, 'Hello'); assert.equal(output.translationStatus, 'completed');
});

test('transcription rejects provider failure and empty speech', async () => {
  const input = { audio: Buffer.from('fake'), mime: 'audio/ogg', filename: 'note.ogg', apiKey: 'test-key' };
  await assert.rejects(() => understandAudio({ ...input, fetchImpl: fakeFetch(result({}, 429)) }), /quota/);
  await assert.rejects(() => understandAudio({ ...input, fetchImpl: fakeFetch(result({text: '  '})) }), /No speech/);
});

test('canonical MIME and international numbers are validated', () => {
  assert.equal(canonicalAudioMime('audio/x-m4a; codecs=aac'), 'audio/mp4');
  assert.equal(canonicalAudioMime('video/mp4'), null);
  assert.equal(normalizePhone('+234 (800) 000-0000'), '2348000000000');
  assert.throws(() => normalizePhone('abc'));
});

test('audio probing falls back to decoded timestamps when WebM lacks duration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voicebridge-test-'));
  const probe = join(dir, 'probe'); const ffmpeg = join(dir, 'ffmpeg'); const old = process.env.FFPROBE_PATH;
  try {
    await writeFile(probe, '#!/bin/sh\nprintf \'%s\' \'{"streams":[{"codec_type":"audio"}],"format":{}}\'\n', { mode: 0o755 });
    await writeFile(ffmpeg, '#!/bin/sh\nprintf "out_time_us=3000000\\nprogress=end\\n"\n', { mode: 0o755 });
    process.env.FFPROBE_PATH = probe;
    assert.equal(await probeAudioDuration(Buffer.from('fake'), 'audio/webm', ffmpeg), 3);
  } finally { if (old === undefined) delete process.env.FFPROBE_PATH; else process.env.FFPROBE_PATH = old; await rm(dir, { recursive: true, force: true }); }
});

test('WhatsApp adapter sends the provider voice flag, not an audio attachment fallback', async () => {
  const original = globalThis.fetch; let requestBody: any;
  globalThis.fetch = (async (_input, init) => {
    if (init?.body instanceof FormData) return result({ id: 'media-1' });
    requestBody = JSON.parse(String(init?.body)); return result({ messages: [{ id: 'message-1' }] });
  }) as typeof fetch;
  try {
    const out = await sendWhatsAppBusinessVoiceMessage({ accessToken: 'test', phoneNumberId: '1', graphApiVersion: 'v1', recipient: '+2348000000000', audio: Buffer.from('test'), audioMimeType: 'audio/ogg; codecs=opus' });
    assert.equal(out.messageId, 'message-1'); assert.equal(requestBody.audio.voice, true); assert.equal(requestBody.audio.id, 'media-1');
  } finally { globalThis.fetch = original; }
});
