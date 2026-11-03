import { useCallback, useEffect, useRef, useState } from "react";
import { audioFormat, inspectAudio, microphoneError, SILENT_PEAKS, validateAudioFile } from "../lib/audio";
import type { AudioClip } from "../lib/types";

type RecordingStatus = "idle" | "requesting" | "recording" | "paused" | "finalizing";

export function useRecorder(maxSeconds: number, maxBytes: number) {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [livePeaks, setLivePeaks] = useState<number[]>(Array(64).fill(0.06));
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const clipRef = useRef<AudioClip | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const startedRef = useRef(0);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const drawRef = useRef<FrameRequestCallback | null>(null);

  const cleanCapture = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
  }, []);

  const acceptBlob = useCallback(async (blob: Blob, name: string, origin: AudioClip["origin"], generation: number): Promise<string | null> => {
    const format = audioFormat({ name, type: blob.type });
    const problem = validateAudioFile({ name, type: blob.type, size: blob.size }, maxBytes);
    if (problem || !format) return problem || "This audio format isn't supported.";
    try {
      const audio = await inspectAudio(blob);
      if (audio.duration > maxSeconds + 0.5) return `Keep your voice note under ${maxSeconds} seconds. This one is ${Math.ceil(audio.duration)} seconds long.`;
      if (audio.duration < 0.5) return "That recording is a little too short. Try speaking for at least a second.";
      if (!mountedRef.current || generation !== generationRef.current) return null;
      const normalized = new Blob([blob], { type: format.mime });
      const next: AudioClip = { blob: normalized, name, ...audio, url: URL.createObjectURL(normalized), origin };
      if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
      clipRef.current = next;
      setClip(next);
      setError(null);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "We couldn't read this audio. Please try another file.";
    }
  }, [maxBytes, maxSeconds]);

  const importFile = useCallback(async (file: File) => {
    const problem = validateAudioFile(file, maxBytes);
    if (problem) { setError(problem); return false; }
    const generation = ++generationRef.current;
    setImporting(true);
    setError(null);
    const format = audioFormat(file)!;
    const name = file.name.replace(/\.[^.]+$/, "") + "." + format.extension;
    const failure = await acceptBlob(file, name, "upload", generation);
    if (!mountedRef.current || generation !== generationRef.current) return false;
    setImporting(false);
    if (failure) { setError(failure); return false; }
    return true;
  }, [acceptBlob, maxBytes]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "recording") elapsedRef.current += (performance.now() - startedRef.current) / 1000;
    setElapsed(elapsedRef.current);
    setStatus("finalizing");
    recorder.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    cancelAnimationFrame(frameRef.current);
  }, []);

  const start = useCallback(async () => {
    if (["requesting", "recording", "paused", "finalizing"].includes(status)) return;
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording needs a secure HTTPS page and a recent browser. You can still upload an audio file.");
      return;
    }
    const generation = ++generationRef.current;
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!mountedRef.current || generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const { preferredRecordingType } = await import("../lib/audio");
      if (!mountedRef.current || generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const mimeType = preferredRecordingType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 96_000 } : undefined);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        cleanCapture();
        setStatus("idle");
        setError("Your browser interrupted the recording. Please try again or upload a file.");
      };
      recorder.onstop = async () => {
        const rawType = recorder.mimeType || mimeType || "audio/webm";
        cleanCapture();
        const format = audioFormat({ name: "recording", type: rawType }) || { mime: "audio/webm", extension: "webm" };
        const blob = new Blob(chunks, { type: format.mime });
        const failure = await acceptBlob(blob, `voice-note-${new Date().toISOString().slice(0, 10)}.${format.extension}`, "microphone", generation);
        if (!mountedRef.current || generation !== generationRef.current) return;
        setStatus("idle");
        if (failure) setError(failure);
      };
      stream.getAudioTracks().forEach((track) => { track.onended = () => { stop(); setError("The microphone disconnected. Any captured audio has been kept when readable."); }; });
      if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
      clipRef.current = null;
      setClip(null);
      elapsedRef.current = 0;
      setElapsed(0);
      startedRef.current = performance.now();
      recorder.start(250);
      setStatus("recording");
      timerRef.current = setInterval(() => {
        if (recorder.state !== "recording") return;
        const seconds = elapsedRef.current + (performance.now() - startedRef.current) / 1000;
        setElapsed(Math.min(seconds, maxSeconds));
        if (seconds >= maxSeconds) stop();
      }, 100);
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        contextRef.current = context;
        await context.resume().catch(() => undefined);
        if (!mountedRef.current || generation !== generationRef.current) { cleanCapture(); return; }
        if (recorder.state === "inactive") return;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const rolling = Array<number>(64).fill(0.06);
        let lastFrame = 0;
        const draw = (time: number) => {
          if (recorder.state !== "recording") return;
          if (time - lastFrame > 55) {
            analyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
            rolling.shift();
            rolling.push(Math.min(1, Math.max(0.06, Math.sqrt(sum / samples.length) * 5)));
            setLivePeaks([...rolling]);
            lastFrame = time;
          }
          frameRef.current = requestAnimationFrame(draw);
        };
        drawRef.current = draw;
        frameRef.current = requestAnimationFrame(draw);
      }
    } catch (cause) {
      cleanCapture();
      if (mountedRef.current && generation === generationRef.current) { setStatus("idle"); setError(microphoneError(cause)); }
    }
  }, [acceptBlob, cleanCapture, maxSeconds, status, stop]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state !== "recording") return;
    recorderRef.current.pause();
    elapsedRef.current += (performance.now() - startedRef.current) / 1000;
    setElapsed(elapsedRef.current);
    cancelAnimationFrame(frameRef.current);
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state !== "paused") return;
    recorderRef.current.resume();
    startedRef.current = performance.now();
    setStatus("recording");
    if (drawRef.current) frameRef.current = requestAnimationFrame(drawRef.current);
  }, []);

  const reset = useCallback(() => {
    generationRef.current++;
    const recorder = recorderRef.current;
    if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; if (recorder.state !== "inactive") recorder.stop(); }
    recorderRef.current = null;
    cleanCapture();
    if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
    clipRef.current = null;
    setClip(null); setStatus("idle"); setElapsed(0); setError(null); setImporting(false); setLivePeaks(Array(64).fill(0.06));
    elapsedRef.current = 0;
  }, [cleanCapture]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current++;
      const recorder = recorderRef.current;
      if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; if (recorder.state !== "inactive") recorder.stop(); }
      cleanCapture();
      if (clipRef.current) URL.revokeObjectURL(clipRef.current.url);
    };
  }, [cleanCapture]);

  return { status, clip, elapsed, livePeaks: status === "recording" ? livePeaks : SILENT_PEAKS, error, importing, start, stop, pause, resume, reset, importFile, clearError: () => setError(null) };
}
