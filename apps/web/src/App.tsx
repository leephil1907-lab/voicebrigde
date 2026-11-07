import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, AudioWaveform, FileAudio2, SlidersHorizontal, CircleUserRound, BookOpenText, Check, CheckCheck, ChevronDown, CircleHelp, CirclePlus, Globe2, Headphones, Languages, Link2, LoaderCircle, LockKeyhole, LogOut, Menu, MessageCircle, Mic, Moon, Sun, UserRound, Pause, Play, Radio, RefreshCw, Share2, ShieldCheck, Sparkles, Square, Upload, X } from "lucide-react";
import { Brand, SoundGlobe } from "./components/Brand";
import { AudioPlayer } from "./components/AudioPlayer";
import { AuthDialog } from "./components/AuthDialog";
import { ConnectionDialog } from "./components/ConnectionDialog";
import { Waveform } from "./components/Waveform";
import { ProviderIcon } from "./components/ProviderIcon";
import { PersonalWhatsAppConnection, PersonalWhatsAppSend } from "./components/PersonalWhatsApp";
import { usePersonalWhatsApp } from "./hooks/usePersonalWhatsApp";
import { useRecorder } from "./hooks/useRecorder";
import { useSession } from "./hooks/useSession";
import { useTranslation } from "./hooks/useTranslation";
import { apiRequest, downloadAudio, fetchHealth, saveBlob } from "./lib/api";
import { audioFormat, formatTime, inspectAudio, validateAudioFile } from "./lib/audio";
import { createShareAudioFile } from "./lib/share-audio";
import { formatDate, stageMessage, statusLabel } from "./lib/jobs";
import type { AccountOverview, BillingCatalog, ConnectionStatus, Health, HistoryJob, RuntimeConfig, VoiceProfile } from "./lib/types";

// Flags are representative visual cues, not limits on the regions or dialects supported.
const LANGUAGES = [
  ["es","Spanish","Español","🇪🇸"],["fr","French","Français","🇫🇷"],
  ["pt","Portuguese","Português","🇵🇹"],["de","German","Deutsch","🇩🇪"],
  ["it","Italian","Italiano","🇮🇹"],["ar","Arabic","العربية","🇸🇦"],
  ["hi","Hindi","हिन्दी","🇮🇳"],["ja","Japanese","日本語","🇯🇵"],
  ["ko","Korean","한국어","🇰🇷"],["zh","Chinese","中文","🇨🇳"],
  ["en","English","English","🇬🇧"],["nl","Dutch","Nederlands","🇳🇱"],
  ["ru","Russian","Русский","🇷🇺"],["tr","Turkish","Türkçe","🇹🇷"],
  ["sw","Swahili","Kiswahili","🇹🇿"],["ha","Hausa","Hausa","🇳🇬"],
  ["yo","Yoruba","Yorùbá","🇳🇬"],["ur","Urdu","اردو","🇵🇰"],
];
const languageName = (code: string | null | undefined) => LANGUAGES.find(l => l[0] === code)?.[1] || code?.toUpperCase() || "Auto-detect";
type Reading = { sourceText: string; englishText: string; sourceLanguage: string | null; translationStatus: string };
type View = "studio" | "read" | "settings" | "account";

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try { const saved = localStorage.getItem("voicebridge-theme"); if (saved === "light" || saved === "dark") return saved; } catch { /* storage can be blocked */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("voicebridge-theme", theme); } catch { /* theme still works in this session */ }
  }, [theme]);
  const [config, setConfig] = useState<RuntimeConfig | null>(null), [health, setHealth] = useState<Health | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("checking");
  const [connectionOpen, setConnectionOpen] = useState(false), [authOpen, setAuthOpen] = useState(false), [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<View>("studio"), [message, setMessage] = useState("");
  const [target, setTarget] = useState("es"), [source, setSource] = useState("auto"), [consent, setConsent] = useState(false);
  const [items, setItems] = useState<HistoryJob[]>([]), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState("");
  const [readingFile, setReadingFile] = useState<File | null>(null), [readConsent, setReadConsent] = useState(false), [reading, setReading] = useState<Reading | null>(null), [readBusy, setReadBusy] = useState(false);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [sharePeaks, setSharePeaks] = useState<number[] | null>(null);
  const [sharePreparing, setSharePreparing] = useState(false);
  const [shareError, setShareError] = useState("");
  const refreshConnection = useCallback(async () => { setConnection("checking"); try { const [c,h] = await Promise.all([apiRequest<RuntimeConfig>("/config"), fetchHealth()]); setConfig(c); setHealth(h); setConnection(c.supabaseUrl && c.supabasePublishableKey && Object.values(h.capabilities).every(Boolean) ? "ready" : "setup"); } catch { setConnection("offline"); } }, []);
  useEffect(() => { void refreshConnection(); }, [refreshConnection]);
  const auth = useSession(config);
  const personalWhatsApp = usePersonalWhatsApp(auth.session?.user.id, auth.getToken);
  const recorder = useRecorder(config?.maxAudioSeconds || 120, config?.maxAudioBytes || 20 * 1024 * 1024);
  const refreshHistory = useCallback(async () => { if (!auth.session) { setItems([]); setHistoryError(""); return; } setHistoryLoading(true); setHistoryError(""); try { const data = await apiRequest<{ items: HistoryJob[] }>("/v1/voice/translations", {}, await auth.getToken()); setItems(data.items); } catch (error) { setHistoryError((error as Error).message); } finally { setHistoryLoading(false); } }, [auth.session, auth.getToken]);
  const [accountOverview, setAccountOverview] = useState<AccountOverview | null>(null);
  const [accountOverviewLoading, setAccountOverviewLoading] = useState(false);
  const [accountOverviewError, setAccountOverviewError] = useState("");
  const [billingCatalog, setBillingCatalog] = useState<BillingCatalog | null>(null);
  const [billingCatalogLoading, setBillingCatalogLoading] = useState(false);
  const [billingBusyCode, setBillingBusyCode] = useState("");
  const [billingError, setBillingError] = useState("");

  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [voiceProfilesLoading, setVoiceProfilesLoading] = useState(false);
  const [voiceProfileError, setVoiceProfileError] = useState("");
  const [voiceProfileName, setVoiceProfileName] = useState("");
  const [voiceProfileScope, setVoiceProfileScope] = useState<"own_voice" | "authorized_third_party">("own_voice");
  const [voiceProfileSpeaker, setVoiceProfileSpeaker] = useState("");
  const [voiceProfileConsent, setVoiceProfileConsent] = useState(false);
  const [voiceProfileBusy, setVoiceProfileBusy] = useState(false);
  const refreshAccountOverview = useCallback(async () => {
    if (!auth.session) { setAccountOverview(null); setAccountOverviewError(""); return; }
    setAccountOverviewLoading(true); setAccountOverviewError("");
    try { setAccountOverview(await apiRequest<AccountOverview>("/v1/account/overview", {}, await auth.getToken())); }
    catch (error) { setAccountOverviewError((error as Error).message); }
    finally { setAccountOverviewLoading(false); }
  }, [auth.session, auth.getToken]);
  useEffect(() => { void refreshAccountOverview(); }, [refreshAccountOverview]);
  const refreshBillingCatalog = useCallback(async () => {
    if (!auth.session) { setBillingCatalog(null); return; }
    setBillingCatalogLoading(true); setBillingError("");
    try { setBillingCatalog(await apiRequest<BillingCatalog>("/v1/billing/catalog", {}, await auth.getToken())); }
    catch (error) { setBillingError((error as Error).message); }
    finally { setBillingCatalogLoading(false); }
  }, [auth.session, auth.getToken]);
  useEffect(() => { void refreshBillingCatalog(); }, [refreshBillingCatalog]);
  const startBillingCheckout = async (type: "credit_topup" | "subscription", productCode: string) => {
    const busyCode = type + ":" + productCode;
    setBillingBusyCode(busyCode); setBillingError("");
    try {
      const result = await apiRequest<{ authorizationUrl: string }>("/v1/billing/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, productCode }),
      }, await auth.getToken());
      window.location.assign(result.authorizationUrl);
    } catch (error) { setBillingError((error as Error).message); setBillingBusyCode(""); }
  };
  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get("reference");
    if (!auth.session || !reference || !reference.startsWith("VB-")) return;
    let active = true;
    void (async () => {
      try {
        const result = await apiRequest<{ status: string; alreadyProcessed: boolean }>(
          "/v1/billing/verify/" + encodeURIComponent(reference), {}, await auth.getToken(),
        );
        if (!active) return;
        flash(result.alreadyProcessed ? "Payment was already confirmed." : "Payment confirmed. Your account has been updated.");
        await Promise.all([refreshAccountOverview(), refreshBillingCatalog()]);
      } catch (error) {
        if (active) setBillingError((error as Error).message);
      } finally {
        if (active) {
          const url = new URL(window.location.href);
          url.searchParams.delete("reference"); url.searchParams.delete("trxref"); url.searchParams.delete("paystack");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }
      }
    })();
    return () => { active = false; };
  }, [auth.session?.user.id, auth.getToken, refreshAccountOverview, refreshBillingCatalog]);

  const refreshVoiceProfiles = useCallback(async () => {
    if (!auth.session) { setVoiceProfiles([]); setVoiceProfileError(""); return; }
    setVoiceProfilesLoading(true); setVoiceProfileError("");
    try { const data = await apiRequest<{ items: VoiceProfile[] }>("/v1/account/voice-profiles", {}, await auth.getToken()); setVoiceProfiles(data.items); }
    catch (error) { setVoiceProfileError((error as Error).message); }
    finally { setVoiceProfilesLoading(false); }
  }, [auth.session, auth.getToken]);
  useEffect(() => { void refreshVoiceProfiles(); }, [refreshVoiceProfiles]);
  const createVoiceProfile = async () => {
    if (!voiceProfileName.trim() || !voiceProfileConsent || (voiceProfileScope === "authorized_third_party" && !voiceProfileSpeaker.trim())) return;
    setVoiceProfileBusy(true); setVoiceProfileError("");
    try {
      await apiRequest("/v1/account/voice-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: voiceProfileName.trim(), consentScope: voiceProfileScope, speakerName: voiceProfileSpeaker.trim() || undefined }) }, await auth.getToken());
      setVoiceProfileName(""); setVoiceProfileSpeaker(""); setVoiceProfileConsent(false);
      await refreshVoiceProfiles(); flash("Voice permission saved to your account.");
    } catch (error) { setVoiceProfileError((error as Error).message); }
    finally { setVoiceProfileBusy(false); }
  };
  const revokeVoiceProfile = async (id: string) => {
    if (!window.confirm("Revoke this voice permission? It will no longer be available for future use.")) return;
    try { await apiRequest(`/v1/account/voice-profiles/${id}/revoke`, { method: "POST" }, await auth.getToken()); await refreshVoiceProfiles(); flash("Voice permission revoked."); }
    catch (error) { setVoiceProfileError((error as Error).message); }
  };
  const translation = useTranslation(auth.getToken, () => { void refreshHistory(); });
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  const previousUser = useRef<string | null>(null);
  useEffect(() => {
    const id = auth.session?.user.id || null;
    if (previousUser.current && previousUser.current !== id) {
      translation.reset(); recorder.reset(); setReading(null); setReadingFile(null); setConsent(false);
    }
    previousUser.current = id;
  }, [auth.session?.user.id, translation.reset, recorder.reset]);
  const flash = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(""), 9000); };
  const go = (next: View) => { setView(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "auto" }); };
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);
  const start = async () => { if (!auth.session) { if (!auth.client) setConnectionOpen(true); else setAuthOpen(true); return; } if (!recorder.clip) return; await translation.start(recorder.clip, source, consent, target); };
  const newNote = () => { translation.reset(); recorder.reset(); setConsent(false); setView("studio"); };
  const download = async () => { if (!translation.job?.audioUrl) return; try { saveBlob(await downloadAudio(translation.job.audioUrl), `voicebridge-${translation.job.targetLanguage}.ogg`); } catch (error) { flash((error as Error).message); } };
  // Prepare the audio before the user taps Share: browsers require share() to
  // be called during the tap's transient user activation, not after a fetch.
  useEffect(() => {
    let cancelled = false;
    setShareFile(null); setSharePeaks(null); setShareError("");
    const job = translation.job;
    if (!auth.session || job?.status !== "completed" || !job.audioUrl) { setSharePreparing(false); return; }
    setSharePreparing(true);
    void downloadAudio(job.audioUrl).then(async blob => {
      const file = await createShareAudioFile(blob, job.targetLanguage);
      if (cancelled) return;
      setShareFile(file);
      // The waveform shown here comes from the actual translated audio, not a decorative sample.
      void inspectAudio(file).then(({ peaks }) => { if (!cancelled) setSharePeaks(peaks); }).catch(() => {});
    }).catch(error => { if (!cancelled) setShareError(error instanceof Error ? error.message : "Could not prepare the audio. Refresh the preview and try again."); })
      .finally(() => { if (!cancelled) setSharePreparing(false); });
    return () => { cancelled = true; };
  }, [translation.job?.id, translation.job?.status, translation.job?.audioUrl, translation.job?.targetLanguage, auth.session?.user.id]);
  const shareAudio = async () => {
    if (!shareFile) { flash(shareError || "The audio is still being prepared."); return; }
    try {
      if (!navigator.share || !navigator.canShare?.({ files: [shareFile] })) {
        flash("This browser cannot share audio directly. Try a supported mobile browser."); return;
      }
      await navigator.share({ files: [shareFile] });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      flash("Could not open sharing. Try again in a supported mobile browser.");
    }
  };
  const read = async () => { if (!auth.session) { if (!auth.client) setConnectionOpen(true); else setAuthOpen(true); return; } if (!readingFile || !readConsent) return; const problem = validateAudioFile(readingFile, config?.maxAudioBytes || 20 * 1024 * 1024); if (problem) { flash(problem); return; } const format = audioFormat(readingFile); if (!format) return; setReadBusy(true); setReading(null); try { const form = new FormData(); form.append("file", new Blob([readingFile], { type: format.mime }), `incoming.${format.extension}`); form.append("processingConsent", "true"); setReading(await apiRequest<Reading>("/v1/voice/understand", { method: "POST", body: form, signal: AbortSignal.timeout(150000) }, await auth.getToken())); } catch (error) { flash((error as Error).message); } finally { setReadBusy(false); } };
  const current = translation.job;
  const activeRecording = recorder.status === "recording" || recorder.status === "paused";
  const availableLanguages = LANGUAGES.filter(([v]) => !config?.targetLanguages?.length || config.targetLanguages.includes(v));
  return <div className="app-layout">
    {menuOpen && <button className="mobile-overlay" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
    <aside className={`app-sidebar ${menuOpen ? "open" : ""}`} aria-label="VoiceBridge workspace sidebar">
      <div className="sidebar-top"><Brand /><button className="icon-button close-mobile" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={20} /></button></div>
      <div className="sidebar-section-label">YOUR STUDIO</div>
      <nav id="primary-navigation" className="app-nav" aria-label="Main navigation">
        <button className={view === "studio" ? "active" : ""} aria-current={view === "studio" ? "page" : undefined} onClick={() => go("studio")}><AudioWaveform size={19} /><span>Translate voice</span></button>
        <button className={view === "read" ? "active" : ""} aria-current={view === "read" ? "page" : undefined} onClick={() => go("read")}><FileAudio2 size={19} /><span>Read a voice note</span></button>
        <button className={view === "settings" ? "active" : ""} aria-current={view === "settings" ? "page" : undefined} onClick={() => go("settings")}><SlidersHorizontal size={19} /><span>Connections</span></button>
        <button className={view === "account" ? "active" : ""} aria-current={view === "account" ? "page" : undefined} onClick={() => go("account")}><CircleUserRound size={19} /><span>My account</span></button>
      </nav>
      <div className="recent-title"><span>RECENT NOTES</span><button onClick={() => void refreshHistory()} aria-label="Refresh recent notes"><RefreshCw size={15} className={historyLoading ? "spin" : ""} /></button></div>
      <div className="recent-items">{!auth.session ? <p>Sign in to access your voice notes.</p> : historyError ? <p>{historyError}</p> : !items.length ? <p>Your translated notes will appear here.</p> : items.slice(0,8).map(item => <button key={item.id} className={current?.id === item.id && view === "studio" ? "selected" : ""} onClick={() => { go("studio"); void translation.open(item.id); }}><span className="recent-mark"><AudioLines size={16} /></span><span><strong>{languageName(item.target_language)} voice note</strong><small>{statusLabel(item.status)} · {formatDate(item.created_at)}</small></span></button>)}</div>
      <div className="sidebar-bottom"><div className="sidebar-security"><ShieldCheck size={17} /><span>Private by design<small>Your voice, your control.</small></span></div><button className="sidebar-account" onClick={() => auth.session ? go("account") : auth.client ? setAuthOpen(true) : setConnectionOpen(true)}><span className="user-avatar">{auth.session?.user.email?.[0].toUpperCase() || "V"}</span><span className="account-details"><strong>{auth.session?.user.email || "Your account"}</strong><small>{auth.session ? "View account" : "Sign in or create account"}</small></span><ArrowRight size={16} /></button></div>
    </aside>
    <div className="app-main"><header className="top-bar"><div className="top-left"><button className="icon-button menu-mobile" onClick={() => setMenuOpen(true)} aria-label="Open navigation" aria-controls="primary-navigation" aria-expanded={menuOpen}><Menu size={21} /></button><span className="top-page-title">{view === "studio" ? "Translate voice" : view === "read" ? "Read a voice note" : view === "account" ? "My account" : "Connections"}</span></div><div className="top-actions"><button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button><button className="status-button" onClick={() => go("settings")} aria-label={connection === "ready" ? "Services configured. Open connections." : connection === "checking" ? "Checking services. Open connections." : "Connection needed. Open connections."} title="Open connection status"><span className={`status-dot ${connection}`} />{connection === "ready" ? "Services configured" : connection === "checking" ? "Checking services" : "Connection needed"}</button>{!auth.session ? <button className="top-signin" onClick={() => auth.client ? setAuthOpen(true) : setConnectionOpen(true)}>Sign in <ArrowRight size={15} /></button> : <button className="top-user" aria-label="Open my account" title="My account" onClick={() => go("account")}>{auth.session.user.email?.[0].toUpperCase() || "U"}</button>}</div></header>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <button className={view === "studio" ? "active" : ""} aria-current={view === "studio" ? "page" : undefined} onClick={() => go("studio")}><AudioWaveform size={19} /><span>Translate</span></button>
        <button className={view === "read" ? "active" : ""} aria-current={view === "read" ? "page" : undefined} onClick={() => go("read")}><FileAudio2 size={19} /><span>Read note</span></button>
        <button className={view === "settings" ? "active" : ""} aria-current={view === "settings" ? "page" : undefined} onClick={() => go("settings")}><SlidersHorizontal size={19} /><span>Connections</span></button>
        <button className={view === "account" ? "active" : ""} aria-current={view === "account" ? "page" : undefined} onClick={() => go("account")}><CircleUserRound size={19} /><span>Account</span></button>
      </nav>
      {message && <div className="toast" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss"><X size={16} /></button></div>}
      {view === "studio" && <main className="content-wrap"><div className="page-heading"><div className="page-heading-copy"><div className="eyebrow-label">VOICE TRANSLATION <span /> YOUR VOICE, MORE LANGUAGES</div><h1>Say it your way.<br /><span>They'll hear it in theirs.</span></h1><p>Record a message and translate it while keeping the sound of your voice.</p></div><div className="hero-visual" aria-hidden="true"><SoundGlobe language={target.toUpperCase()} /></div><button className="button-outline new-note" onClick={newNote}><CirclePlus size={17} /> New note</button></div>
      {connection !== "ready" && connection !== "checking" && <div className="alert-banner"><Link2 size={18} /><div><strong>Service connection needed</strong><p>Recording works in your browser. Connect the backend to translate and save notes.</p></div><button onClick={() => go("settings")}>View connections <ArrowRight size={15} /></button></div>}
      <div className="hero-feature-row"><span><AudioLines size={15} /> Voice-first translation</span><span><Globe2 size={15} /> Multilingual conversations</span><span><ShieldCheck size={15} /> Preview before sharing</span></div><div className="workflow-grid"><div className="workflow-left"><section className="work-card recording-card"><div className="card-header"><div className="section-heading"><span className="step-icon"><Mic size={19} /></span><div><span className="section-kicker">STEP 01</span><h2>Your voice note</h2></div></div><span className="limit-badge">MAX {Math.round((config?.maxAudioSeconds || 120) / 60)} MIN · {config?.maxTranslationsPerDay || 3}/DAY</span></div><p className="card-description">Record a new message or upload an audio file from your device.</p>
      {recorder.clip ? <div className="recorded-box"><div className="recorded-label"><span><Check size={14} /> Original recording · {formatTime(recorder.clip.duration)}</span><button onClick={recorder.reset}>Remove <X size={14} /></button></div><AudioPlayer src={recorder.clip.url} label="Original recording" peaks={recorder.clip.peaks} durationHint={recorder.clip.duration} onDownload={() => saveBlob(recorder.clip!.blob, recorder.clip!.name)} /></div> : <div className={`recorder-area ${activeRecording ? "recording" : ""}`}><div className="recorder-art"><div className="recorder-rings"><button className={`record-control ${activeRecording ? "stop" : ""}`} onClick={() => activeRecording ? recorder.stop() : void recorder.start()} disabled={!activeRecording && recorder.status !== "idle"} aria-label={activeRecording ? "Stop recording" : "Start recording"}>{activeRecording ? <Square size={20} fill="currentColor" /> : <Mic size={24} />}</button></div></div><div className="record-copy"><strong>{activeRecording ? recorder.status === "paused" ? "Recording paused" : "Recording in progress" : recorder.status === "requesting" ? "Waiting for microphone access" : recorder.status === "finalizing" ? "Preparing recording" : "Start recording"}</strong><span>{activeRecording ? `${formatTime(recorder.elapsed)} / ${formatTime(config?.maxAudioSeconds || 120)}` : "Tap the microphone and speak naturally"}</span></div>{activeRecording && <button className="pause-button" onClick={recorder.status === "paused" ? recorder.resume : recorder.pause}>{recorder.status === "paused" ? <Play size={15} /> : <Pause size={15} />}{recorder.status === "paused" ? "Resume" : "Pause"}</button>}<div className="recorder-wave"><Waveform peaks={recorder.livePeaks} live={recorder.status === "recording"} /></div></div>}
      {recorder.error && <div className="inline-alert error" role="alert">{recorder.error}</div>}<div className="upload-row"><label className="upload-action"><Upload size={16} /> {recorder.importing ? "Preparing audio…" : "Upload audio"}<input type="file" accept="audio/*,.ogg,.opus,.m4a,.mp3,.wav,.webm" disabled={activeRecording || recorder.status !== "idle"} onChange={e => { const file = e.target.files?.[0]; if (file) void recorder.importFile(file); e.target.value = ""; }} /></label><span>MP3, M4A, WAV, OGG or WebM · up to {Math.round((config?.maxAudioBytes || 20 * 1024 * 1024) / 1024 / 1024)} MB</span></div></section>
      <section className="work-card language-card"><div className="card-header"><div className="section-heading"><span className="step-icon"><Globe2 size={19} /></span><div><span className="section-kicker">STEP 02</span><h2>Choose your languages</h2></div></div></div><p className="card-description">We'll use your recording as the voice reference for the translation.</p><div className="language-grid"><label>Spoken language<div className="select-field"><select value={source} onChange={e => setSource(e.target.value)}><option value="auto">🌐 Detect automatically</option>{LANGUAGES.map(([v,n,,flag]) => <option key={v} value={v}>{flag} {n}</option>)}</select><ChevronDown size={16} /></div></label><span className="language-direction"><ArrowRight size={16} /></span><label>Translate into<div className="select-field"><select value={target} onChange={e => setTarget(e.target.value)}>{availableLanguages.map(([v,n,native,flag]) => <option key={v} value={v}>{flag} {n} · {native}</option>)}</select><ChevronDown size={16} /></div></label></div><p className="language-flag-note">Flags are representative; languages are spoken in many places.</p><label className="consent-line"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I confirm this is my voice, or I have the speaker's permission to reproduce it.</span></label><div className="translate-footer"><button className="button-primary translate-action" onClick={() => void start()} disabled={!recorder.clip || !consent || translation.busy}>{translation.busy ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{translation.busy ? "Translating…" : !auth.session ? "Sign in & translate" : "Translate voice note"}<ArrowRight size={16} /></button><span><LockKeyhole size={14} /> Your recording is sent securely for processing.</span></div></section>
      {(current || translation.phase === "uploading" || translation.error || translation.notice) && <section className="work-card result-card" id="result"><div className="card-header"><div className="section-heading"><span className="step-icon"><AudioLines size={19} /></span><div><span className="section-kicker">STEP 03</span><h2>Your translation</h2></div></div>{current && <span className={`result-status ${current.status}`}>{statusLabel(current.status)}</span>}</div>
      {translation.error ? <div className="error-state" role="alert"><strong>We couldn't complete this request.</strong><p>{translation.error}</p>{translation.notice && <p>{translation.notice}</p>}{current && <button className="text-link" onClick={() => void translation.open(current.id)}>Check note status <RefreshCw size={14} /></button>}</div> : translation.notice ? <div className="notice-state">{translation.notice}{current && <button className="text-link" onClick={() => void translation.open(current.id)}>Check note status</button>}</div> : translation.busy || (current && ["queued","processing"].includes(current.status)) ? <div className="progress-state"><LoaderCircle className="spin" size={22} /><div><strong>{translation.phase === "uploading" ? "Uploading your recording" : stageMessage(current?.stage || "queued")}</strong><p>Translation can take a few minutes. You can return to this note from Recent notes.</p></div></div> : current?.status === "completed" && current.audioUrl ? <><div className="result-info"><div><strong>{languageName(current.targetLanguage)} voice note</strong><p>AI-generated using your voice as a reference · #{current.id.slice(0, 6)}</p></div><span className="language-chip">{current.targetLanguage.toUpperCase()}</span></div><AudioPlayer src={current.audioUrl} label={`${languageName(current.targetLanguage)} voice note`} peaks={sharePeaks || Array(64).fill(0.06)} translated onRefresh={() => void translation.open(current.id)} /><div className="result-actions"><button className="button-outline" onClick={() => void download()}><ArrowDownToLine size={16} /> Download audio</button><button className="button-outline" disabled={sharePreparing} onClick={() => void shareAudio()}><Share2 size={16} /> {sharePreparing ? "Preparing to share…" : "Share with an app"}</button><button className="button-outline" onClick={() => void translation.open(current.id)}><RefreshCw size={15} /> Refresh preview</button></div><p className="result-caption"><MessageCircle size={15} /> On Android, choose WhatsApp in the share sheet, then choose your recipient and send. WhatsApp controls the message style and waveform; they may vary by device. No message is sent automatically.</p>{(current.translatedTranscript || current.sourceTranscript) && <details className="transcript-panel"><summary>View transcripts <ChevronDown size={16} /></summary>{current.translatedTranscript && <p><strong>{languageName(current.targetLanguage)}</strong><br />{current.translatedTranscript}</p>}{current.sourceTranscript && <p><strong>Original</strong><br />{current.sourceTranscript}</p>}</details>}<p className="result-caption"><Headphones size={15} /> Listen and check the translation before sharing.</p><PersonalWhatsAppSend key={current.id} wa={personalWhatsApp} jobId={current.id}/></> : <p className="card-description">Select a note from Recent notes to see its progress.</p>}</section>}
      </div><aside className="workflow-right"><section className="quick-card"><div className="quick-card-top"><span className="quick-icon"><AudioLines size={20} /></span><span className="quick-tag">VOICE MATCHING</span></div><h2>Your voice.<br />A new language.</h2><p>VoiceBridge uses your recording as a reference to create a translated voice note that sounds like you.</p><div className="mini-wave" aria-hidden="true"><Waveform peaks={[.15,.25,.38,.23,.57,.38,.8,.56,.95,.62,.4,.72,.4,.85,.62,.34,.6,.32,.45,.22,.3,.14]} /></div><div className="quick-note"><ShieldCheck size={16} /> Only use voices you have permission to reproduce.</div></section>
      <section className="work-card send-card"><div className="send-heading"><span className="step-icon"><Share2 size={18} /></span><div><span className="section-kicker">AFTER TRANSLATION</span><h2>Share your voice note</h2></div></div><p>Preview your translation. To send on Android, choose WhatsApp in your share sheet, select a recipient and tap send.</p><button className="button-primary send-action" disabled={!current?.audioUrl || current.status !== "completed" || sharePreparing} onClick={() => void shareAudio()}><Share2 size={17} />{sharePreparing ? "Preparing to share…" : "Share with an app"}</button><p className="send-disclaimer">The file is mono OGG/Opus. WhatsApp decides whether to display a voice-note bubble and waveform; this can vary by device. Nothing is sent automatically.</p>{shareError && <p className="delivery-notice" role="status">{shareError}</p>}</section></aside></div><p className="footer-note"><ShieldCheck size={15} /> Your notes are private to your account. AI translations can make mistakes.</p></main>}
      {view === "read" && <main className="content-wrap secondary-page"><div className="secondary-heading"><span className="eyebrow-label">VOICE TO TEXT</span><h1>Understand every message.</h1><p>Turn an incoming voice note into English text.</p></div><div className="secondary-grid"><section className="work-card read-card"><div className="section-heading"><span className="step-icon"><BookOpenText size={19} /></span><div><span className="section-kicker">INCOMING VOICE NOTE</span><h2>Upload a voice note</h2></div></div><p className="card-description">First, save or export the audio from WhatsApp, Telegram or another app.</p><label className="file-drop"><span className="file-drop-icon"><Upload size={22} /></span><strong>{readingFile ? readingFile.name : "Choose an audio file"}</strong><span>MP3, M4A, WAV, OGG or WebM · up to 20 MB and 2 minutes</span><span className="browse-action">Browse files</span><input type="file" accept="audio/*,.ogg,.opus,.m4a,.mp3,.wav,.webm" onChange={e => { setReadingFile(e.target.files?.[0] || null); setReading(null); }} /></label><label className="consent-line"><input type="checkbox" checked={readConsent} onChange={e => setReadConsent(e.target.checked)} /> I have permission to send this recording to the transcription provider.</label><button className="button-primary read-action" onClick={() => void read()} disabled={!readingFile || !readConsent || readBusy}>{readBusy ? <LoaderCircle size={17} className="spin" /> : <Languages size={17} />}{readBusy ? "Converting…" : !auth.session ? "Sign in & convert to English" : "Convert to English"}<ArrowRight size={16} /></button>{reading && <div className="reading-output"><span className="section-kicker">ENGLISH TRANSLATION</span>{reading.translationStatus === "completed" ? <p>{reading.englishText}</p> : <p>English translation was unavailable. The original transcript is shown below.</p>}<details><summary>View original transcript {reading.sourceLanguage && `(${reading.sourceLanguage})`}</summary><p>{reading.sourceText}</p></details><small>AI transcription and translation can make mistakes. Verify important details.</small></div>}</section><aside className="info-card"><span className="info-icon"><ShieldCheck size={22} /></span><h3>Built for understanding</h3><p>Incoming audio is used for transcription and translation only. The sender's voice is not cloned.</p><div className="info-divider" /><h4>How it works</h4><ol><li>Save the audio from your messaging app.</li><li>Upload it here with permission.</li><li>Read the English translation.</li></ol><p className="info-foot">Personal WhatsApp inboxes cannot be connected directly.</p></aside></div></main>}
      {view === "settings" && <main className="content-wrap secondary-page connections-page">
        <div className="secondary-heading"><span className="eyebrow-label">YOUR VOICEBRIDGE WORKSPACE</span><h1>Connections</h1><p>See how your voice engine and sharing options are working.</p></div>
        <div className="connections-intro"><span className="connections-intro-icon"><ShieldCheck size={21} /></span><div><strong>You're always in control</strong><p>Preview your translation, choose your recipient and confirm before sending.</p></div></div>
        <div className="settings-grid"><section className="work-card settings-card engine-card"><div className="section-heading"><span className="step-icon"><AudioLines size={19} /></span><div><span className="section-kicker">TRANSLATION</span><h2>Voice engine</h2></div><span className={`settings-badge ${connection === "ready" ? "good" : ""}`}>{connection === "checking" ? "Checking" : connection === "ready" ? "Configured" : connection === "offline" ? "Unavailable" : "Setup needed"}</span></div><p className="card-description">The services behind your translations and private voice notes.</p><div className="check-rows">{[["Supabase authentication", !!health?.capabilities.authentication], ["Private storage and job queue", !!health?.capabilities.privateAudioStorage && !!health?.capabilities.durableJobs], ["ElevenLabs voice dubbing", !!health?.capabilities.audioToAudioDubbing]].map(([name,ready]) => <div key={String(name)}><span className={ready ? "check-good" : "check-pending"}>{ready ? <Check size={13} /> : "·"}</span>{name}<small>{connection === "checking" ? "Checking" : ready ? "Configured" : "Unavailable"}</small></div>)}</div><p className="settings-explain">Configuration status does not verify provider credentials or confirm the background worker is running.</p><div className="settings-actions"><button className="button-outline" onClick={() => void refreshConnection()}><RefreshCw size={15} className={connection === "checking" ? "spin" : ""} /> Check again</button><button className="text-link" onClick={() => setConnectionOpen(true)}>Service details <ArrowRight size={15} /></button></div></section>
        <section className="work-card settings-card channel-card"><div className="section-heading"><span className="step-icon"><Share2 size={18} /></span><div><span className="section-kicker">MESSAGING</span><h2>Share from your device</h2></div></div><p className="card-description">Choose an app after translating. VoiceBridge will not send a message automatically.</p><div className="channel-list">{([ ["whatsapp", "WhatsApp"], ["telegram", "Telegram"] ] as const).map(([provider,name]) => <div className="channel-row" key={provider}><span className={`channel-icon ${provider}`}><ProviderIcon provider={provider} width={21} height={21} /></span><div><strong>{name}</strong><p>Use your device's share sheet</p></div><span className="channel-badge">Manual share</span></div>)}</div><p className="settings-explain">{personalWhatsApp.status === "unavailable" ? "Direct account connections are not available yet. " : "Personal WhatsApp linking is available to the owner only. "}Sharing support and how audio appears depend on your device and the receiving app.</p><div className="settings-actions"><button className="button-outline" onClick={() => go("studio")}>Go to voice studio <ArrowRight size={15} /></button></div></section></div><PersonalWhatsAppConnection wa={personalWhatsApp} />
      </main>}
      {view === "account" && <main className="content-wrap secondary-page account-page"><div className="secondary-heading"><span className="eyebrow-label">YOUR PROFILE</span><h1>My account</h1><p>Manage your session and return to your voice notes.</p></div>{auth.session ? <div className="account-grid"><section className="work-card account-notes"><div className="card-header"><div><span className="section-kicker">PLAN & USAGE</span><h2>Billing overview</h2></div><button className="text-link" onClick={() => void refreshAccountOverview()} disabled={accountOverviewLoading}><RefreshCw size={15} className={accountOverviewLoading ? "spin" : ""} /> Refresh</button></div>{accountOverviewError ? <p className="card-description" role="alert">{accountOverviewError}</p> : accountOverviewLoading || !accountOverview ? <p className="card-description">Loading your plan and usage…</p> : <><div className="account-plan-row"><div><span className="section-kicker">CURRENT PLAN</span><h3>{accountOverview.planCode.charAt(0).toUpperCase() + accountOverview.planCode.slice(1)}</h3><p>{accountOverview.subscriptionStatus === "free" ? "Free account" : accountOverview.subscriptionStatus.replaceAll("_", " ")}</p></div><span className="language-chip">{accountOverview.currency}</span></div><dl className="account-details-list"><div><dt>Translations · last 30 days</dt><dd>{accountOverview.translationsLast30Days}</dd></div><div><dt>Current rolling 24-hour limit</dt><dd>{accountOverview.maxTranslationsPer24Hours}</dd></div><div><dt>Available credits</dt><dd>{accountOverview.creditsAvailable} · {Math.floor(accountOverview.creditsAvailable / 60)} min</dd></div>{accountOverview.currentPeriodEnd && <div><dt>Billing period ends</dt><dd>{formatDate(accountOverview.currentPeriodEnd)}</dd></div>}</dl><p className="settings-explain">Paystack is the billing provider. Credits and subscriptions are only activated after server-side payment verification.</p></>}</section><section className="work-card account-notes paystack-billing-card"><div className="card-header"><div><span className="section-kicker">SECURE CHECKOUT</span><h2>Credits & plans</h2></div><button className="text-link" onClick={() => void refreshBillingCatalog()} disabled={billingCatalogLoading}><RefreshCw size={15} className={billingCatalogLoading ? "spin" : ""} /> Refresh</button></div><p className="card-description">60 credits equal one translation minute. Audio is charged in whole-minute blocks, separately for each target language. Failed translations are refunded automatically. Paystack payments are verified server-side.</p>{billingError && <p className="inline-alert error" role="alert">{billingError}</p>}{billingCatalogLoading ? <p className="card-description">Loading available payment options…</p> : !billingCatalog?.enabled ? <p className="settings-explain">Paystack credentials have not been added to the server yet. Checkout will appear here after payment credentials and product prices are configured.</p> : <><div className="billing-subheading"><h3>Credit top-ups</h3><span>One-time payment · NGN</span></div>{billingCatalog.creditPackages.length ? <div className="billing-product-grid">{billingCatalog.creditPackages.map(item => <article className="billing-product" key={item.code}><div><strong>{item.name}</strong><p>{item.description || "Add credits to your VoiceBridge account."}</p></div><div className="billing-product-bottom"><span>{new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(item.amountMinor/100)}</span><small>{Math.floor(item.credits / 60).toLocaleString("en-NG")} translation minute{item.credits === 60 ? "" : "s"}</small></div><button className="button-primary" disabled={Boolean(billingBusyCode)} onClick={() => void startBillingCheckout("credit_topup",item.code)}>{billingBusyCode === "credit_topup:"+item.code ? <LoaderCircle size={15} className="spin" /> : null} Buy credits <ArrowRight size={15} /></button></article>)}</div> : <p className="settings-explain">No credit packages have been published yet.</p>}<div className="billing-subheading"><h3>Monthly & annual plans</h3><span>Recurring billing · NGN</span></div>{billingCatalog.subscriptionPlans.length ? <div className="billing-product-grid">{billingCatalog.subscriptionPlans.map(item => <article className="billing-product" key={item.code}><div><strong>{item.name}</strong><p>{item.description || "VoiceBridge subscription."}</p></div><div className="billing-product-bottom"><span>{new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(item.amountMinor/100)}</span><small>per {item.interval === "month" ? "month" : "year"} · {item.includedMinutes} minutes included</small></div><button className="button-primary" disabled={Boolean(billingBusyCode)} onClick={() => void startBillingCheckout("subscription",item.code)}>{billingBusyCode === "subscription:"+item.code ? <LoaderCircle size={15} className="spin" /> : null} Subscribe <ArrowRight size={15} /></button></article>)}</div> : <p className="settings-explain">Recurring plans will appear after their Paystack plan codes and prices are configured.</p>}</>}</section><section className="work-card account-profile"><div className="profile-header"><span className="profile-avatar" aria-hidden="true">{auth.session.user.email?.[0].toUpperCase() || "V"}</span><div><span className="section-kicker">SIGNED IN</span><h2>Your profile</h2><p>{auth.session.user.email || "Email unavailable"}</p></div></div><dl className="account-details-list"><div><dt>Email address</dt><dd>{auth.session.user.email || "Not available"}</dd></div><div><dt>Email verification</dt><dd>{auth.session.user.email_confirmed_at ? "Confirmed" : "Not available"}</dd></div><div><dt>Member since</dt><dd>{auth.session.user.created_at ? formatDate(auth.session.user.created_at) : "Not available"}</dd></div></dl><button className="button-outline" onClick={() => void auth.signOut().then(() => { go("studio"); flash("You have signed out."); }).catch(error => flash(error instanceof Error ? error.message : "Could not sign out. Please try again."))}><LogOut size={16} /> Sign out</button></section><section className="work-card account-notes"><div className="card-header"><div><span className="section-kicker">YOUR VOICE NOTES</span><h2>Recent translations</h2></div><button className="text-link" onClick={() => void refreshHistory()} disabled={historyLoading}><RefreshCw size={15} className={historyLoading ? "spin" : ""} /> Refresh</button></div>{historyError ? <p className="card-description" role="alert">{historyError}</p> : historyLoading ? <p className="card-description">Loading your notes…</p> : !items.length ? <p className="card-description">Your translated voice notes will appear here.</p> : <div className="account-note-list">{items.slice(0,5).map(item => <button key={item.id} onClick={() => {go("studio"); void translation.open(item.id);}}><span><strong>{languageName(item.target_language)} voice note</strong><small>{formatDate(item.created_at)}</small></span><span>{statusLabel(item.status)}</span><ArrowRight size={16} /></button>)}</div>}<button className="button-outline" onClick={newNote}><CirclePlus size={16} /> Create a voice note</button></section><section className="work-card account-notes voice-profiles-card"><div className="card-header"><div><span className="section-kicker">VOICE PERMISSIONS</span><h2>Authorized voices</h2></div><button className="text-link" onClick={() => void refreshVoiceProfiles()} disabled={voiceProfilesLoading}><RefreshCw size={15} className={voiceProfilesLoading ? "spin" : ""} /> Refresh</button></div><p className="card-description">Save consent records for voices you are authorized to process. These records do not create a permanent cloned voice; translations continue to use the current source recording as the Dubbing v2 reference.</p><div className="voice-profile-form"><label>Profile name<input value={voiceProfileName} onChange={e => setVoiceProfileName(e.target.value)} maxLength={80} placeholder="e.g. My voice" /></label><label>Permission type<select value={voiceProfileScope} onChange={e => setVoiceProfileScope(e.target.value as "own_voice" | "authorized_third_party")}><option value="own_voice">My own voice</option><option value="authorized_third_party">Someone else's voice (with permission)</option></select></label>{voiceProfileScope === "authorized_third_party" && <label>Speaker name<input value={voiceProfileSpeaker} onChange={e => setVoiceProfileSpeaker(e.target.value)} maxLength={80} placeholder="Speaker's name" /></label>}<label className="consent-line"><input type="checkbox" checked={voiceProfileConsent} onChange={e => setVoiceProfileConsent(e.target.checked)} /><span>I confirm that I am the speaker, or that the speaker has explicitly authorized VoiceBridge to store this voice permission record and process their voice for the selected purpose. I understand consent can be revoked for future use.</span></label><button className="button-primary" onClick={() => void createVoiceProfile()} disabled={voiceProfileBusy || !voiceProfileName.trim() || !voiceProfileConsent || (voiceProfileScope === "authorized_third_party" && !voiceProfileSpeaker.trim())}>{voiceProfileBusy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />} Save voice permission</button></div>{voiceProfileError && <p className="inline-alert error" role="alert">{voiceProfileError}</p>}{voiceProfilesLoading ? <p className="card-description">Loading voice permissions…</p> : voiceProfiles.length ? <div className="account-note-list">{voiceProfiles.map(profile => <div key={profile.id} className="voice-profile-row"><span><strong>{profile.display_name}</strong><small>{profile.consent?.consent_scope === "own_voice" ? "Own voice" : `Authorized: ${profile.consent?.speaker_name || "Speaker"}`} · {profile.status}</small></span>{profile.status === "active" ? <button className="text-link" onClick={() => void revokeVoiceProfile(profile.id)}>Revoke</button> : <span className="channel-badge">Revoked</span>}</div>)}</div> : <p className="card-description">No saved voice permissions yet.</p>}</section></div> : <section className="work-card account-profile"><div className="section-heading"><span className="step-icon"><UserRound size={19} /></span><div><h2>Your account</h2></div></div><p className="card-description">Sign in to see your profile and voice notes.</p><button className="button-primary" onClick={() => auth.client ? setAuthOpen(true) : setConnectionOpen(true)}>Sign in <ArrowRight size={16} /></button></section>}</main>}
    <footer className="legal-links"><span>VoiceBridge AI</span><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="https://github.com/leephil1907-lab/voicebrigde/issues" target="_blank" rel="noreferrer">Report a technical issue</a><a href="mailto:emmanuelramzey8@gmail.com" aria-label="Email VoiceBridge" title="Email VoiceBridge"><svg width="19" height="19" viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M3 7.1V19h3.4V9.7z"/><path fill="#34A853" d="M17.6 9.7V19H21V7.1z"/><path fill="#FBBC04" d="M6.4 9.7V19h11.2V9.7L12 14z"/><path fill="#EA4335" d="M3 7.1l9 6.9 9-6.9V5.8c0-1-.8-1.8-1.8-1.8H4.8C3.8 4 3 4.8 3 5.8z"/></svg></a></footer></div><AuthDialog open={authOpen || auth.recovery} client={auth.client} recovery={auth.recovery} onClose={() => { setAuthOpen(false); if (auth.recovery) auth.clearRecovery(); }} onRecoveryDone={auth.clearRecovery} onMessage={flash} /><ConnectionDialog open={connectionOpen} onClose={() => setConnectionOpen(false)} status={connection} health={health} config={config} onRetry={refreshConnection} /></div>;
}
