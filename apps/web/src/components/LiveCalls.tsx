import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowRight, Copy, LoaderCircle, Mic, PhoneCall, PhoneOff, Radio, Share2, ShieldCheck, Volume2 } from "lucide-react";
import { apiRequest } from "../lib/api";

const LANGUAGES = [
  ["en","English"],["es","Spanish"],["fr","French"],["pt","Portuguese"],["de","German"],["it","Italian"],
  ["ar","Arabic"],["zh","Chinese"],["ja","Japanese"],["ko","Korean"],["ha","Hausa"],["yo","Yoruba"],
  ["sw","Swahili"],["hi","Hindi"],["nl","Dutch"],["ru","Russian"],["tr","Turkish"],["ur","Urdu"],["id","Indonesian"],["vi","Vietnamese"],
] as const;
const OUTPUT_LANGUAGES = [
  ["en","English"],["es","Spanish"],["pt","Portuguese"],["fr","French"],["ja","Japanese"],["ru","Russian"],
  ["zh","Chinese"],["de","German"],["ko","Korean"],["hi","Hindi"],["id","Indonesian"],["vi","Vietnamese"],["it","Italian"],
] as const;

type ActiveCall = { id: string; role: "host" | "guest"; inviteToken?: string };
type Props = { client: SupabaseClient | null; getToken: () => Promise<string>; signedIn: boolean; onSignIn: () => void; onMessage: (message: string) => void };

export function LiveCalls({ client, getToken, signedIn, onSignIn, onMessage }: Props) {
  const [spokenLanguage, setSpokenLanguage] = useState("en");
  const [preferredLanguage, setPreferredLanguage] = useState("es");
  const [callId, setCallId] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [captions, setCaptions] = useState("");
  const [busy, setBusy] = useState(false);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const sidecarRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const translatedAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const offerStartedRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("call");
    const token = params.get("invite");
    if (id && token) { setCallId(id); setInviteToken(token); }
  }, []);

  const cleanup = useCallback(() => {
    if (channelRef.current) { void client?.removeChannel(channelRef.current); channelRef.current = null; }
    sidecarRef.current?.close(); sidecarRef.current = null;
    peerRef.current?.getSenders().forEach(sender => sender.track?.stop());
    peerRef.current?.close(); peerRef.current = null;
    localStreamRef.current?.getTracks().forEach(track => track.stop()); localStreamRef.current = null;
    if (remoteAudioRef.current) { remoteAudioRef.current.pause(); remoteAudioRef.current.srcObject = null; remoteAudioRef.current.volume = 1; }
    if (translatedAudioRef.current) { translatedAudioRef.current.pause(); translatedAudioRef.current.srcObject = null; }
    pendingIceRef.current = []; offerStartedRef.current = false;
  }, [client]);

  useEffect(() => () => cleanup(), [cleanup]);

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try { await navigator.clipboard.writeText(inviteUrl); onMessage("Live call invitation copied."); }
    catch { onMessage("Copy this invitation link from the address bar."); }
  };

  const createCall = async () => {
    if (!signedIn) { onSignIn(); return; }
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ id: string; inviteToken: string; status: string }>("/v1/live-calls", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "in_app", spokenLanguage, preferredLanguage }),
      }, await getToken());
      const url = new URL(window.location.href);
      url.searchParams.set("call", result.id); url.searchParams.set("invite", result.inviteToken);
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      setCallId(result.id); setInviteToken(result.inviteToken);
      setInviteUrl(url.toString());
      setActiveCall({ id: result.id, role: "host", inviteToken: result.inviteToken });
      setStatus("waiting");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create a call."); }
    finally { setBusy(false); }
  };

  const joinCall = async () => {
    if (!signedIn) { onSignIn(); return; }
    if (!callId.trim() || !inviteToken.trim()) { setError("Open a valid VoiceBridge invitation link first."); return; }
    setBusy(true); setError("");
    try {
      await apiRequest("/v1/live-calls/" + encodeURIComponent(callId) + "/join", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken, spokenLanguage, preferredLanguage }),
      }, await getToken());
      setActiveCall({ id: callId, role: "guest" });
      setStatus("connecting");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not join this call."); }
    finally { setBusy(false); }
  };

  const startTranslation = useCallback(async (remoteTrack: MediaStreamTrack, call: ActiveCall) => {
    if (sidecarRef.current) return;
    try {
      const session = await apiRequest<{ clientSecret: string; targetLanguage: string }>(
        "/v1/live-calls/" + encodeURIComponent(call.id) + "/translation-session",
        { method: "POST" }, await getToken(),
      );
      const pc = new RTCPeerConnection();
      sidecarRef.current = pc;
      const events = pc.createDataChannel("oai-events");
      const sourceStream = new MediaStream([remoteTrack]);
      pc.addTrack(remoteTrack, sourceStream);
      pc.ontrack = ({ streams }) => {
        if (translatedAudioRef.current) {
          translatedAudioRef.current.srcObject = streams[0];
          void translatedAudioRef.current.play().catch(() => {});
        }
      };
      remoteTrack.onunmute = () => { if (remoteAudioRef.current) remoteAudioRef.current.volume = 0.16; };
      remoteTrack.onmute = () => { if (remoteAudioRef.current) remoteAudioRef.current.volume = 1; };
      events.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data) as { type?: string; delta?: string };
          if (event.type === "session.output_transcript.delta" && event.delta) setCaptions(value => (value + event.delta).slice(-900));
          if (event.type === "error") setError("Live translation reported an audio processing error. The original call audio remains available.");
        } catch { /* ignore non-JSON provider messages */ }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const response = await fetch("https://api.openai.com/v1/realtime/translations/calls", {
        method: "POST",
        headers: { Authorization: "Bearer " + session.clientSecret, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!response.ok) throw new Error("The live translation provider rejected the audio session.");
      await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
    } catch (e) {
      sidecarRef.current?.close(); sidecarRef.current = null;
      if (remoteAudioRef.current) remoteAudioRef.current.volume = 1;
      setError(e instanceof Error ? e.message : "Could not start live translation.");
    }
  }, [getToken]);

  useEffect(() => {
    if (!activeCall || !client) return;
    let cancelled = false;
    let polling: number | undefined;
    let peer: RTCPeerConnection | null = null;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;
    const sendSignal = async (payload: Record<string, unknown>) => {
      if (!channel) return;
      await channel.send({ type: "broadcast", event: "signal", payload });
    };
    const addRemoteCandidate = async (candidate: RTCIceCandidateInit) => {
      if (!peer) return;
      if (!peer.remoteDescription) { pendingIceRef.current.push(candidate); return; }
      try { await peer.addIceCandidate(candidate); } catch { /* stale ICE after reconnect */ }
    };
    const start = async () => {
      try {
        setStatus(activeCall.role === "host" ? "waiting" : "connecting");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        localStreamRef.current = stream;
        peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        peerRef.current = peer;
        stream.getTracks().forEach(track => peer!.addTrack(track, stream));
        peer.onicecandidate = event => { if (event.candidate) void sendSignal({ type: "ice", candidate: event.candidate.toJSON() }); };
        peer.ontrack = event => {
          const remoteStream = event.streams[0] || new MediaStream([event.track]);
          if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = remoteStream; void remoteAudioRef.current.play().catch(() => {}); }
          if (event.track.kind === "audio") void startTranslation(event.track, activeCall);
        };
        peer.onconnectionstatechange = () => {
          if (peer?.connectionState === "connected") setStatus("connected");
          if (peer?.connectionState === "failed" || peer?.connectionState === "disconnected") setStatus("reconnecting");
        };
        channel = client.channel("voicebridge:call:" + activeCall.id, { config: { private: true, broadcast: { ack: true, self: false } } });
        channelRef.current = channel;
        channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
          if (cancelled || !peer) return;
          if (payload.type === "offer" && activeCall.role === "guest" && !peer.remoteDescription) {
            await peer.setRemoteDescription(payload.description as RTCSessionDescriptionInit);
            for (const candidate of pendingIceRef.current.splice(0)) await addRemoteCandidate(candidate);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await sendSignal({ type: "answer", description: peer.localDescription });
          } else if (payload.type === "answer" && activeCall.role === "host" && !peer.remoteDescription) {
            await peer.setRemoteDescription(payload.description as RTCSessionDescriptionInit);
            for (const candidate of pendingIceRef.current.splice(0)) await addRemoteCandidate(candidate);
          } else if (payload.type === "ice" && payload.candidate) {
            await addRemoteCandidate(payload.candidate as RTCIceCandidateInit);
          } else if (payload.type === "call-ended") {
            setStatus("ended"); cleanup(); setActiveCall(null);
          }
        });
        channel.subscribe(async state => {
          if (state !== "SUBSCRIBED" || cancelled) return;
          setStatus(activeCall.role === "host" ? "waiting" : "connecting");
          if (activeCall.role === "host") {
            polling = window.setInterval(async () => {
              try {
                const call = await apiRequest<{ status: string }>("/v1/live-calls/" + encodeURIComponent(activeCall.id), {}, await getToken());
                if (call.status === "active" && peer && peer.connectionState !== "connected") {
                  if (!offerStartedRef.current) {
                    offerStartedRef.current = true;
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    setStatus("connecting");
                  }
                  if (peer.localDescription) await sendSignal({ type: "offer", description: peer.localDescription });
                }
                if (call.status === "ended" || call.status === "failed") { setStatus("ended"); cleanup(); setActiveCall(null); }
              } catch { /* transient status polling failure */ }
            }, 1500);
          }
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not access the microphone or connect to the call.");
        setStatus("error");
      }
    };
    void start();
    return () => {
      cancelled = true;
      if (polling) window.clearInterval(polling);
      if (channel) void client.removeChannel(channel);
      if (peer) peer.close();
      if (peerRef.current === peer) peerRef.current = null;
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      sidecarRef.current?.close(); sidecarRef.current = null;
    };
  }, [activeCall?.id, activeCall?.role, client, getToken, startTranslation, cleanup]);

  const endCall = async () => {
    if (!activeCall) return;
    const call = activeCall;
    try {
      if (channelRef.current) await channelRef.current.send({ type: "broadcast", event: "signal", payload: { type: "call-ended" } });
      await apiRequest("/v1/live-calls/" + encodeURIComponent(call.id) + "/end", { method: "POST" }, await getToken());
    } catch { /* local cleanup must still happen */ }
    cleanup(); setActiveCall(null); setStatus("ended");
    const url = new URL(window.location.href); url.searchParams.delete("call"); url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  };

  const languageSelect = (value: string, onChange: (value: string) => void, output = false) => (
    <select value={value} onChange={event => onChange(event.target.value)}>
      {(output ? OUTPUT_LANGUAGES : LANGUAGES).map(([code, name]) => <option value={code} key={code}>{name}</option>)}
    </select>
  );

  return <main className="content-wrap secondary-page live-calls-page">
    <div className="secondary-heading"><span className="eyebrow-label">REAL-TIME INTERPRETER</span><h1>Speak naturally.<br />Understand each other.</h1><p>Start a private two-person call. Each person speaks their language and hears the other in their preferred language.</p></div>
    {!signedIn ? <section className="work-card live-call-card"><ShieldCheck size={22} /><h2>Sign in to start a live call</h2><p>Your calls are linked to your VoiceBridge account.</p><button className="button-primary" onClick={onSignIn}>Sign in <ArrowRight size={16} /></button></section> : activeCall ? <section className="work-card live-call-card active-live-call">
      <div className="live-call-status"><span className={status === "connected" ? "status-dot ready" : "status-dot checking"} />{status === "connected" ? "Connected" : status === "waiting" ? "Waiting for the other person" : status === "reconnecting" ? "Reconnecting" : status === "ended" ? "Call ended" : "Connecting…"}</div>
      <div className="live-call-orb"><Radio size={32} /></div>
      <h2>{status === "waiting" ? "Your invitation is ready" : status === "connected" ? "You're on a live call" : "Preparing your call"}</h2>
      <p>{status === "waiting" ? "Share the secure invitation link with the person you want to speak with." : "Keep this page open and allow microphone access. Translated speech will play as the other person talks."}</p>
      {inviteUrl && <div className="invite-copy"><input readOnly value={inviteUrl} aria-label="Live call invitation link" /><button className="button-outline" onClick={() => void copyInvite()}><Copy size={16} /> Copy link</button><button className="button-outline" onClick={() => window.open("https://wa.me/?text="+encodeURIComponent("Join my VoiceBridge live translation call: "+inviteUrl),"_blank","noopener,noreferrer")}><Share2 size={16} /> WhatsApp</button></div>}
      <div className="live-call-audio"><audio ref={remoteAudioRef} autoPlay playsInline /><audio ref={translatedAudioRef} autoPlay playsInline /><span><Mic size={16} /> Microphone active</span><span><Volume2 size={16} /> Translated audio enabled</span></div>
      {captions && <div className="live-captions"><span>LIVE TRANSLATION</span><p>{captions}</p></div>}
      <button className="button-primary live-end-button" onClick={() => void endCall()}><PhoneOff size={17} /> End call</button>
    </section> : <div className="live-call-grid">
      <section className="work-card live-call-card"><div className="section-heading"><span className="step-icon"><PhoneCall size={19} /></span><div><span className="section-kicker">START A CALL</span><h2>Create an invitation</h2></div></div><p className="card-description">Choose the language you speak and the language you want to hear from the other person.</p><label>Your spoken language{languageSelect(spokenLanguage,setSpokenLanguage)}</label><label>Language you want to hear{languageSelect(preferredLanguage,setPreferredLanguage,true)}</label><button className="button-primary" onClick={() => void createCall()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <PhoneCall size={16} />} Create live call <ArrowRight size={16} /></button></section>
      <section className="work-card live-call-card"><div className="section-heading"><span className="step-icon"><Radio size={19} /></span><div><span className="section-kicker">JOIN A CALL</span><h2>Use an invitation</h2></div></div><p className="card-description">Open the link shared by the other person. The call code and secure invitation are filled in automatically.</p><label>Call ID<input value={callId} onChange={event => setCallId(event.target.value)} placeholder="Call ID from invitation" /></label><label>Invitation token<input value={inviteToken} onChange={event => setInviteToken(event.target.value)} placeholder="Secure invitation token" /></label><label>Your spoken language{languageSelect(spokenLanguage,setSpokenLanguage)}</label><label>Language you want to hear{languageSelect(preferredLanguage,setPreferredLanguage)}</label><button className="button-primary" onClick={() => void joinCall()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <PhoneCall size={16} />} Join live call <ArrowRight size={16} /></button></section>
    </div>}
    {error && <p className="inline-alert error" role="alert">{error}</p>}
    <p className="footer-note"><ShieldCheck size={15} /> Calls are not recorded by default. Translation audio is processed live and is not saved as a voice note.</p>
  </main>;
}
