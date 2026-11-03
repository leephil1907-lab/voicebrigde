import { useState } from "react";
import { Check, CircleAlert, Database, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, AudioLines } from "lucide-react";
import type { ConnectionStatus, Health, RuntimeConfig } from "../lib/types";
import { Modal } from "./Modal";

export function ConnectionDialog({ open, onClose, status, health, config, onRetry }: { open: boolean; onClose: () => void; status: ConnectionStatus; health: Health | null; config: RuntimeConfig | null; onRetry: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const rows = [
    { icon: KeyRound, name: "Account sign-in", ready: Boolean(config?.supabaseUrl && config.supabasePublishableKey), detail: "Supabase authentication is connected to this studio." },
    { icon: Database, name: "Translation queue", ready: Boolean(health?.capabilities.durableJobs), detail: "The database is reachable and can store translation jobs." },
    { icon: ShieldCheck, name: "Private audio storage", ready: Boolean(health?.capabilities.privateAudioStorage), detail: "The private VoiceBridge audio bucket is available." },
    { icon: AudioLines, name: "Voice provider key", ready: Boolean(health?.capabilities.audioToAudioDubbing), detail: "An ElevenLabs key is present. A real translation is still needed to verify provider access and worker processing." },
  ];
  return <Modal open={open} onClose={onClose} title={status === "ready" ? "Your studio is connected." : "Connection status"} eyebrow="VOICEBRIDGE SERVICES" wide>
    <p className="modal-intro">This is the live VoiceBridge deployment. The checks below show what the server currently reports; a configured key does not by itself prove that a provider request or translation has succeeded.</p>
    <div className="connection-checklist">{rows.map(({ icon: Icon, name, ready, detail }) => <div className="connection-row" key={name}><span className="connection-icon"><Icon size={19} /></span><div><strong>{name}</strong><p>{detail}</p></div><span className={`connection-state ${ready ? "connected" : ""}`}>{ready ? <Check size={15} /> : <CircleAlert size={15} />}{ready ? "Available" : "Needs attention"}</span></div>)}</div>
    <p className="fine-print"><ShieldCheck size={15} /> Choose an app and recipient yourself when sharing a translated note. No social account connection is needed.</p>
    <div className="modal-actions"><button className="button button-primary" disabled={checking} onClick={async () => { setChecking(true); try { await onRetry(); } finally { setChecking(false); } }}>{checking ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}{checking ? "Checking…" : "Refresh status"}</button></div>
  </Modal>;
}
