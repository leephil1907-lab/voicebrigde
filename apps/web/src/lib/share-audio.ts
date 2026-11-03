/** Build a file for the system share sheet. The worker supplies mono Ogg/Opus;
 * verify its first Ogg page rather than trusting the response Content-Type. This
 * is a format sanity check, not a full integrity or decodability check. */
export async function createShareAudioFile(blob: Blob, language: string): Promise<File> {
  const header = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const ascii = (start: number, length: number) => String.fromCharCode(...header.slice(start, start + length));
  const segments = header[26] || 0;
  const packet = 27 + segments;
  const firstPacketLength = segments ? header[27] : 0;
  if (header.length < packet + 19 || ascii(0, 4) !== "OggS" || header[4] !== 0 || !(header[5] & 2) ||
      firstPacketLength < 19 || firstPacketLength === 255 || ascii(packet, 8) !== "OpusHead" || header[packet + 9] !== 1) {
    throw new Error("This audio isn't a compatible mono OGG/Opus file. Refresh the preview and try again.");
  }
  // A plain Android MIME type avoids relying on apps accepting codec parameters.
  const safeLanguage = /^[a-z]{2,3}$/i.test(language) ? language.toLowerCase() : "translated";
  return new File([blob], `voicebridge-${safeLanguage}.ogg`, { type: "audio/ogg" });
}
