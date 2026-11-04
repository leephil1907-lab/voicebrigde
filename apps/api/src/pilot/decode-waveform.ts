import { spawn } from 'node:child_process';
import { waveformFromPcm16 } from './waveform.js';

/** Decode the actual server-produced Ogg/Opus file into bounded PCM. This does
 * not send the message or imply that WhatsApp will render its waveform. */
export async function decodeVoiceWaveform(audio: Buffer, ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<{ waveform: Uint8Array; seconds: number }> {
  if (audio.length < 4 || audio.length > 16 * 1024 * 1024 || audio.subarray(0, 4).toString('ascii') !== 'OggS') throw new Error('Expected an Ogg audio file under 16 MB.');
  const maxBytes = 16000 * 2 * 120;
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-map', '0:a:0', '-vn', '-t', '121', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['pipe','pipe','pipe'] });
    const chunks: Buffer[] = []; let total = 0; let failed = false;
    const fail = (error: Error) => { if (failed) return; failed = true; proc.kill('SIGKILL'); reject(error); };
    const timer = setTimeout(() => fail(new Error('Audio decoding timed out.')), 30_000);
    proc.stdout.on('data', (chunk: Buffer) => { total += chunk.length; if (total > maxBytes) fail(new Error('Audio exceeds the 120-second limit.')); else chunks.push(chunk); });
    // Drain stderr without logging potentially sensitive provider data.
    proc.stderr.resume();
    proc.stdin.on('error', () => { /* close/error handlers report decoder failure */ });
    proc.on('error', error => { clearTimeout(timer); fail(error); });
    proc.on('close', code => { clearTimeout(timer); if (failed) return; if (code !== 0 || !total) return fail(new Error('Could not decode the voice note.')); resolve(Buffer.concat(chunks, total)); });
    proc.stdin.end(audio);
  });
  return waveformFromPcm16(pcm);
}
