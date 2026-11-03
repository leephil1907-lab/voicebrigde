import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getTranslation, uploadTranslation } from "../lib/api";
import type { AudioClip, TranslationJob } from "../lib/types";

type Phase = "idle" | "uploading" | "polling" | "completed" | "failed";

export function useTranslation(getToken: () => Promise<string>, onComplete: () => void) {
  const [job, setJob] = useState<TranslationJob | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const completedRef = useRef(onComplete);
  completedRef.current = onComplete;

  const cancel = useCallback(() => {
    generationRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const reset = useCallback(() => { cancel(); setJob(null); setPhase("idle"); setError(null); setNotice(null); }, [cancel]);

  const open = useCallback(async (id: string) => {
    cancel();
    const generation = generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setJob(null); setError(null); setNotice(null); setPhase("polling");
    try {
      const token = await getToken();
      const next = await getTranslation(id, token, controller.signal);
      if (generation !== generationRef.current) return;
      setJob(next);
      setPhase(next.status === "completed" ? "completed" : next.status === "failed" ? "failed" : "polling");
      if (next.error) setError(next.error);
    } catch (cause) {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setPhase("failed"); setError(cause instanceof Error ? cause.message : "We couldn't open this voice note.");
    }
  }, [cancel, getToken]);

  const start = useCallback(async (clip: AudioClip, sourceLanguage: string, consent: boolean, targetLanguage = "es") => {
    cancel();
    const generation = generationRef.current;
    setJob(null); setError(null); setNotice(null); setPhase("uploading");
    try {
      const token = await getToken();
      const response = await uploadTranslation(clip.blob, clip.name, sourceLanguage, token, consent, targetLanguage);
      if (generation !== generationRef.current) return;
      setJob({ id: response.id, status: "queued", stage: "queued", sourceLanguage: sourceLanguage === "auto" ? null : sourceLanguage, targetLanguage, sourceTranscript: "", translatedTranscript: "", audioUrl: null, error: null, createdAt: new Date().toISOString(), completedAt: null });
      setPhase("polling");
      completedRef.current();
      return response.id;
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setPhase("failed"); setError(cause instanceof Error ? cause.message : "We couldn't upload your voice note.");
    }
  }, [cancel, getToken]);

  useEffect(() => {
    if (!job?.id || (job.status !== "queued" && job.status !== "processing")) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = generationRef.current;
    const jobId = job.id;
    const started = Date.now();
    let consecutiveErrors = 0;
    const wait = (ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(() => { controller.signal.removeEventListener("abort", aborted); resolve(); }, ms);
      const aborted = () => { clearTimeout(timer); resolve(); };
      controller.signal.addEventListener("abort", aborted, { once: true });
    });
    const poll = async () => {
      await wait(2500);
      while (!controller.signal.aborted && generation === generationRef.current) {
        if (Date.now() - started > 30 * 60 * 1000) {
          setNotice("This is taking longer than expected. Your job may still be running; reopen it from My voice notes instead of submitting a duplicate.");
          setPhase("idle");
          return;
        }
        try {
          const token = await getToken();
          const next = await getTranslation(jobId, token, controller.signal);
          if (controller.signal.aborted || generation !== generationRef.current) return;
          consecutiveErrors = 0;
          setJob(next);
          if (next.status === "completed") { setPhase("completed"); completedRef.current(); return; }
          if (next.status === "failed") { setPhase("failed"); setError(next.error || "The voice service couldn't complete this recording. Try a clearer recording."); return; }
        } catch (cause) {
          if (controller.signal.aborted || generation !== generationRef.current) return;
          consecutiveErrors++;
          if ((cause instanceof ApiError && [401, 403, 404].includes(cause.status)) || consecutiveErrors >= 4) {
            setError(cause instanceof Error ? cause.message : "We couldn't check your translation.");
            setNotice("Your recording may still be processing. Reopen it from My voice notes after reconnecting.");
            setPhase("idle");
            return;
          }
        }
        await wait(Math.min(10_000, 3000 * Math.max(1, consecutiveErrors)));
      }
    };
    void poll();
    return () => controller.abort();
  }, [job?.id, job?.status, getToken]);

  useEffect(() => () => cancel(), [cancel]);
  return { job, phase, error, notice, busy: phase === "uploading" || phase === "polling", start, open, reset };
}
