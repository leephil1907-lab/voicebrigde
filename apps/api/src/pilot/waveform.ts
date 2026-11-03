/** 64 normalized peak-amplitude bins from mono signed PCM16 little-endian audio.
 * This produces candidate WhatsApp PTT metadata, not a guarantee that a client
 * will display it. PCM must be decoded from the same audio that will be sent. */
export function waveformFromPcm16(pcm: Buffer, sampleRate = 16000): { waveform: Uint8Array; seconds: number } {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || pcm.length < 2 || pcm.length % 2 !== 0 || pcm.length > sampleRate * 2 * 120) throw new Error('Invalid PCM audio.');
  const samples = pcm.length / 2;
  const values = new Float64Array(64);
  for (let i = 0; i < samples; i++) {
    const bin = Math.min(63, Math.floor(i * 64 / samples));
    values[bin] = Math.max(values[bin], Math.abs(pcm.readInt16LE(i * 2)));
  }
  const max = Math.max(...values);
  const waveform = Uint8Array.from(values, x => max ? Math.min(100, Math.round(x / max * 100)) : 0);
  return { waveform, seconds: Math.ceil(samples / sampleRate) };
}
