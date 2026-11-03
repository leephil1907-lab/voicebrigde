import { describe, expect, it } from "vitest";
import { jobStep, statusLabel } from "./jobs";
import { audioFormat, validateAudioFile } from "./audio";
describe("voice studio basics", () => {
  it("recognizes common audio and rejects oversized files", () => {
    expect(audioFormat({ name: "note.ogg", type: "audio/ogg" })?.extension).toBe("ogg");
    expect(validateAudioFile({ name: "note.ogg", type: "audio/ogg", size: 100 }, 10)).toBeTruthy();
  });
  it("describes a completed job", () => {
    expect(jobStep("completed", "completed")).toBeGreaterThan(0);
    expect(statusLabel("completed")).toBeTruthy();
  });
});
