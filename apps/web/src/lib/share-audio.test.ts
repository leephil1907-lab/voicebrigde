import { describe, expect, it } from "vitest";
import { File } from "node:buffer";
import { createShareAudioFile } from "./share-audio";

// A minimal Ogg identification-page header: these tests check format
// recognition only; no assertion is made about audio decoding.
function opusHeader(channels = 1) {
  const bytes = new Uint8Array(47);
  bytes.set(new TextEncoder().encode("OggS"), 0); bytes[5] = 2;
  bytes[26] = 1; bytes[27] = 19;
  bytes.set(new TextEncoder().encode("OpusHead"), 28); bytes[36] = 1; bytes[37] = channels;
  return bytes;
}
Object.assign(globalThis, { File });
describe("Android-compatible sharing file", () => {
  it("preserves the Ogg/Opus bytes and labels them as audio/ogg", async () => {
    const bytes = opusHeader(); const file = await createShareAudioFile(new Blob([bytes], { type: "application/octet-stream" }), "FR");
    expect(file.name).toBe("voicebridge-fr.ogg"); expect(file.type).toBe("audio/ogg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });
  it("rejects non-Opus, stereo and truncated responses", async () => {
    for (const bytes of [new TextEncoder().encode("not audio"), opusHeader(2), opusHeader().slice(0, 32)])
      await expect(createShareAudioFile(new Blob([bytes]), "fr")).rejects.toThrow("OGG/Opus");
  });
  it("does not allow an unsafe filename", async () => {
    const file = await createShareAudioFile(new Blob([opusHeader()]), "../../private");
    expect(file.name).toBe("voicebridge-translated.ogg");
  });
});
