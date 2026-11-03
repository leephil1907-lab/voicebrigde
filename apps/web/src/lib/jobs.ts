import type { JobStatus } from "./types";

export const STAGE_MESSAGES: Record<string, string> = {
  queued: "Your voice note is in the queue.",
  uploading_source: "Preparing your original recording.",
  downloading_source: "Preparing your original recording.",
  creating_dubbing_project: "Starting your voice-reference translation.",
  preparing_source: "Listening to the words and delivery in your recording.",
  creating_target_language: "Preparing your selected language.",
  translating_audio: "Translating your words and matching your voice.",
  downloading_translation: "Putting the finishing touches on your voice note.",
  retry_wait: "The service hit a snag. Your job will retry automatically.",
  completed: "Your translated voice note is ready.",
  failed: "This translation couldn't be completed.",
};

export function stageMessage(stage: string): string { return STAGE_MESSAGES[stage] || "Your translated voice note is being prepared."; }

export function jobStep(status: JobStatus, stage: string): number {
  if (status === "completed") return 4;
  if (["preparing_source", "creating_dubbing_project", "downloading_source", "uploading_source"].includes(stage)) return 1;
  if (["translating_audio", "creating_target_language", "downloading_translation"].includes(stage)) return 2;
  return 0;
}

export function statusLabel(status: JobStatus): string {
  return { queued: "Queued", processing: "In progress", completed: "Ready", failed: "Needs attention" }[status];
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent voice note";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
