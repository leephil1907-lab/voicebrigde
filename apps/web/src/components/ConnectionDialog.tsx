import { useState } from "react";
import { ArrowUpRight, Check, CircleAlert, Copy, Database, KeyRound, LoaderCircle, Mic2, RefreshCw, ShieldCheck } from "lucide-react";
import type { ConnectionStatus, Health, RuntimeConfig } from "../lib/types";
import { Modal } from "./Modal";

const SETUP = `# Root .env — server-side secrets stay here\nSUPABASE_URL=https://YOUR_PROJECT.supabase.co\nSUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY\nSUPABASE_SECRET_KEY=YOUR_SERVER_SECRET\nSUPABASE_STORAGE_BUCKET=voicebridge-private\nELEVENLABS_API_KEY=YOUR_ELEVENLABS_KEY\nFFMPEG_PATH=ffmpeg\n\n# apps/web/.env.local\nAPI_PROXY_TARGET=http://127.0.0.1:8080\n\n# Three terminals, from the repository root:\nnpm run dev:api\nnpm run dev:worker\nnpm run dev:web`;

export function ConnectionDialog({ open, onClose, status, health, config, onRetry }: { open: boolean; onClose: () => void; status: ConnectionStatus; health: Health | null; config: RuntimeConfig | null; onRetry: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const rows = [
    { icon: KeyRound, name: "Sign-in configuration", ready: Boolean(config?.supabaseUrl && config.supabasePublishableKey), detail: "Supabase public URL and publishable key" },
    { icon: Database, name: "Durable job queue", ready: health?.capabilities.durableJobs, detail: "Supabase Postgres and the SQL migrations" },
    { icon: ShieldCheck, name: "Private audio storage", ready: health?.capabilities.privateAudioStorage, detail: "Your private voicebridge-private bucket" },
    { icon: Mic2, name: "Voice-matched translation", ready: health?.capabilities.audioToAudioDubbing, detail: "ElevenLabs Dubbing v2 and a running worker" },
  ];
  async function copy() { try { await navigator.clipboard.writeText(SETUP); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); } }
  return <Modal open={open} onClose={onClose} title={status === "ready" ? "Your studio is connected." : "A little setup. Then, hola."} eyebrow="CONNECT YOUR VOICE ENGINE" wide>
    <p className="modal-intro">Recording and original-audio playback work in this browser. To translate into other languages with your recording as the voice reference, connect the existing VoiceBridge backend.</p>
    <div className="connection-checklist">{rows.map(({ icon: Icon, name, ready, detail }) => <div className="connection-row" key={name}><span className="connection-icon"><Icon size={19} /></span><div><strong>{name}</strong><p>{detail}</p></div><span className={`connection-state ${ready ? "connected" : ""}`}>{ready ? <Check size={15} /> : <CircleAlert size={15} />}{ready ? "Configured" : "Needs setup"}</span></div>)}</div>
    <div className="setup-steps"><div><span>1</span><p><strong>Prepare Supabase.</strong> Enable email/password sign-in and apply all migrations in <code>supabase/migrations</code>. Add this site's URL to your Supabase Auth redirect URLs.</p></div><div><span>2</span><p><strong>Add your credentials.</strong> Copy <code>.env.example</code> to the root <code>.env</code> and <code>apps/api/.env</code>. Use an ElevenLabs plan with Dubbing v2 access. Install FFmpeg for the worker.</p></div><div><span>3</span><p><strong>Run the API, worker, and website.</strong> In <code>apps/web/.env.local</code> set <code>API_PROXY_TARGET=http://127.0.0.1:8080</code>. See <code>docs/WEB_SETUP.md</code> for production and messaging configuration.</p></div></div>
    <div className="setup-steps"><div><span>4</span><p><strong>Optional native messaging.</strong> Set WhatsApp Business Cloud API or Telegram bot credentials on the API server, plus <code>VOICEBRIDGE_ALLOWED_USER_IDS</code> with approved Supabase user IDs. Restart the API. Telegram recipients must start the bot and supply a chat ID; personal WhatsApp accounts cannot be linked.</p></div></div>
    <div className="code-block"><div><span>LOCAL SETUP</span><button className="text-button" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy setup"}</button></div><pre>{SETUP}</pre></div>
    <p className="fine-print"><ShieldCheck size={15} /> Put real keys only in server environment settings. Never in browser code, source control, or this chat. Audio is sent for translation only after you confirm permission.</p>
    <div className="modal-actions"><a className="text-button" href="https://elevenlabs.io/docs/developers/guides/cookbooks/dubbing" target="_blank" rel="noreferrer">Provider guide <ArrowUpRight size={15} /></a><button className="button button-primary" disabled={checking} onClick={async () => { setChecking(true); await onRetry(); setChecking(false); }}>{checking ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}{checking ? "Checking…" : "Check connection"}</button></div>
  </Modal>;
}
