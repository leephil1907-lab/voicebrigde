import { useEffect, useState } from "react";
import { ArrowRight, AudioLines, Check, CheckCheck, Copy, Download, FileAudio, Info, LoaderCircle, RefreshCw, Share2, Sparkles, TriangleAlert } from "lucide-react";
import type { TranslationJob } from "../lib/types";
import { jobStep, stageMessage } from "../lib/jobs";
import { AudioPlayer } from "./AudioPlayer";
import { Waveform } from "./Waveform";
import { SpanishFlag } from "./Brand";
import { SILENT_PEAKS } from "../lib/audio";

interface Props {
  job: TranslationJob | null;
  phase: string;
  error: string | null;
  notice: string | null;
  busy: boolean;
  canRetry: boolean;
  downloading: boolean;
  onRetry: () => void;
  onNew: () => void;
  onRefresh: () => void;
  onDownload: () => void;
  onShare: () => void;
  onMessage: (message: string) => void;
}

export function TranslationResult({ job, phase, error, notice, busy, canRetry, downloading, onRetry, onNew, onRefresh, onDownload, onShare, onMessage }: Props) {
  const [tab, setTab] = useState<"es" | "source">("es");
  useEffect(() => setTab("es"), [job?.id]);
  const completed = job?.status === "completed" && Boolean(job.audioUrl);
  const step = job ? jobStep(job.status, job.stage) : 0;
  const transcript = tab === "es" ? job?.translatedTranscript : job?.sourceTranscript;
  async function copyTranscript() { try { await navigator.clipboard.writeText(transcript || ""); onMessage("Transcript copied to your clipboard."); } catch { onMessage("Clipboard access isn't available. You can select and copy the transcript instead."); } }
  return <section className={`result-panel ${completed ? "has-result" : ""}`} id="translation-result" aria-labelledby="result-title" aria-busy={busy}>
    <div className="result-heading"><div className="section-title"><span className="step-number">03</span><h2 id="result-title">Your translated voice</h2></div>{completed ? <span className="status-pill completed"><CheckCheck size={14} /> Ready to listen</span> : <span className="result-heading-note">YOUR TRANSLATED VOICE NOTE</span>}</div>
    {!job && phase !== "uploading" && phase !== "failed" && <div className="result-empty"><span className="result-empty-icon"><FileAudio size={24} /><span><Sparkles size={11} /></span></span><div><h3>Your translated voice note will appear here.</h3><p>Record a message, then translate. Listen before you share.</p></div><div className="empty-wave"><Waveform peaks={SILENT_PEAKS} /><ArrowRight size={18} /><SpanishFlag /></div></div>}
    {(busy || (job && ["queued", "processing"].includes(job.status))) && <div className="processing-state" role="status" aria-live="polite"><div className="processing-top"><span className="processing-orb"><AudioLines size={24} /></span><div><h3>{phase === "uploading" ? "Sending your voice note securely…" : stageMessage(job?.stage || "queued")}</h3><p>Dubbing v2 uses your recording as the voice reference. Good things take a moment.</p></div><LoaderCircle size={22} className="spin" /></div><div className="job-steps">{["Uploaded", "Understand", "Translate & match", "Ready"].map((label, index) => <div className={`${index < step || (index === 0 && job) ? "done" : ""} ${index === step ? "current" : ""}`} key={label}><span>{index < step || (index === 0 && job) ? <Check size={12} /> : index + 1}</span>{label}</div>)}</div><p className="processing-note">You can leave this page open. The server keeps working on your voice note.</p></div>}
    {(phase === "failed" || job?.status === "failed") && error && <div className="result-error"><TriangleAlert size={22} /><div><h3>We hit a little interference.</h3><p>{error}</p>{notice && <p className="fine-print">{notice}</p>}<button className="button button-secondary" onClick={canRetry ? onRetry : onNew} disabled={busy}><RefreshCw size={15} />{canRetry ? "Try this recording again" : "Record or upload again"}</button>{canRetry && <span className="fine-print">A new translation may use additional provider credits.</span>}</div></div>}
    {notice && !error && <div className="inline-alert neutral"><Info size={17} />{notice}</div>}
    {completed && job?.audioUrl && <div className="completed-result"><div className="translation-label"><span className="voice-icon"><AudioLines size={20} /></span><div><strong>{new Intl.DisplayNames(["en"], { type: "language" }).of(job.targetLanguage) || job.targetLanguage}, with your voice as the reference.</strong><span>AI-generated · Give it a listen before sharing</span></div><span className="voice-match-badge"><Sparkles size={13} /> Voice-matched</span></div><AudioPlayer src={job.audioUrl} label="Translated voice note" translated onRefresh={onRefresh} /><div className="result-actions"><button className="button button-primary" onClick={onDownload} disabled={downloading}>{downloading ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{downloading ? "Preparing…" : "Download voice note"}</button><button className="button button-secondary" onClick={onShare} disabled={downloading}><Share2 size={16} /> Share audio</button></div><div className="transcript-section"><div className="transcript-toolbar"><div className="transcript-tabs" role="tablist" aria-label="Transcript language"><button role="tab" aria-selected={tab === "es"} className={tab === "es" ? "active" : ""} onClick={() => setTab("es")}>Translation</button><button role="tab" aria-selected={tab === "source"} className={tab === "source" ? "active" : ""} onClick={() => setTab("source")}>Original{job.sourceLanguage ? ` · ${job.sourceLanguage.toUpperCase()}` : ""}</button></div><button className="icon-button small" disabled={!transcript} onClick={() => void copyTranscript()} aria-label="Copy transcript" title="Copy transcript"><Copy size={15} /></button></div><p className="transcript-text" role="tabpanel">{transcript || "A transcript isn't available for this recording. You can still listen to and download the audio."}</p></div><p className="fine-print result-disclaimer"><Info size={13} /> Voice resemblance can vary. Sharing opens your device's share menu; WhatsApp may show an audio attachment, not a native voice-note bubble.</p></div>}
  </section>;
}
