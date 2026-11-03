import { useState } from "react";
import { Check, CircleAlert, Database, KeyRound, LoaderCircle, MessageCircle, RefreshCw, ShieldCheck, AudioLines, ExternalLink } from "lucide-react";
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
  const channels = [
    { name: "WhatsApp Business", ready: Boolean(config?.channels?.whatsapp), detail: "Cloud API credentials and sender configuration" },
    { name: "Telegram", ready: Boolean(config?.channels?.telegram), detail: "Bot token configured on the server" },
  ];
  return <Modal open={open} onClose={onClose} title={status === "ready" ? "Your studio is connected." : "Connection status"} eyebrow="VOICEBRIDGE SERVICES" wide>
    <p className="modal-intro">This is the live VoiceBridge deployment. The checks below show what the server currently reports; a configured key does not by itself prove that a provider request or translation has succeeded.</p>
    <div className="connection-checklist">{rows.map(({ icon: Icon, name, ready, detail }) => <div className="connection-row" key={name}><span className="connection-icon"><Icon size={19} /></span><div><strong>{name}</strong><p>{detail}</p></div><span className={`connection-state ${ready ? "connected" : ""}`}>{ready ? <Check size={15} /> : <CircleAlert size={15} />}{ready ? "Available" : "Needs attention"}</span></div>)}</div>
    <div className="setup-steps">
      <div><span>1</span><p><strong>WhatsApp Business.</strong> Create a WhatsApp Cloud API app in Meta for Developers. Add `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_GRAPH_API_VERSION` to the Render service environment.</p></div>
      <div><span>2</span><p><strong>Telegram.</strong> Create a bot with BotFather and add `TELEGRAM_BOT_TOKEN` to the Render service environment. Each recipient must start the bot before it can send them a voice note.</p></div>
      <div><span>3</span><p><strong>Authorize your account.</strong> Add your Supabase Auth user UUID to `VOICEBRIDGE_ALLOWED_USER_IDS` in Render. This prevents other signed-in users from spending your connected messaging account's quota.</p></div>
      <div><span>4</span><p><strong>Redeploy and refresh.</strong> Save the Render variables, wait for deployment to finish, then select Check again below. Never enter provider tokens in this website or in source code.</p></div>
    </div>
    <p className="fine-print"><a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer">Meta WhatsApp Cloud API guide <ExternalLink size={13} /></a> · <a href="https://core.telegram.org/bots/api" target="_blank" rel="noreferrer">Telegram Bot API guide <ExternalLink size={13} /></a> · <a href="https://dashboard.render.com/" target="_blank" rel="noreferrer">Open Render environment <ExternalLink size={13} /></a></p>
    <div className="connection-checklist">{channels.map(({ name, ready, detail }) => <div className="connection-row" key={name}><span className="connection-icon"><MessageCircle size={19} /></span><div><strong>{name}</strong><p>{detail}</p></div><span className={`connection-state ${ready ? "connected" : ""}`}>{ready ? <Check size={15} /> : <CircleAlert size={15} />}{ready ? "Configured" : "Not connected"}</span></div>)}</div>
    <p className="fine-print"><ShieldCheck size={15} /> WhatsApp Business and Telegram sends remain unavailable until configured. Personal WhatsApp sharing is a separate Android share-sheet flow and does not guarantee a native voice-note bubble. Native personal-account send access is not offered by WhatsApp. Never put provider secrets in the browser or this chat.</p>
    <div className="modal-actions"><button className="button button-primary" disabled={checking} onClick={async () => { setChecking(true); try { await onRetry(); } finally { setChecking(false); } }}>{checking ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}{checking ? "Checking…" : "Refresh status"}</button></div>
  </Modal>;
}
