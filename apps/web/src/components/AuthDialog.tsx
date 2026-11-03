import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { Modal } from "./Modal";

interface Props { open: boolean; client: SupabaseClient | null; recovery: boolean; onClose: () => void; onRecoveryDone: () => void; onMessage: (message: string) => void }

export function AuthDialog({ open, client, recovery, onClose, onRecoveryDone, onMessage }: Props) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const actualMode = recovery ? "recovery" : mode;
  useEffect(() => { if (open) { setError(""); setNotice(""); setPassword(""); } }, [open, recovery]);

  async function resendConfirmation() {
    if (!client || resendBusy || !email.trim()) {
      setError("Enter your account email address first.");
      return;
    }
    setResendBusy(true); setError(""); setNotice("");
    try {
      const { error: cause } = await client.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (cause) throw cause;
      setNotice("If this account is awaiting confirmation, a fresh confirmation email has been requested. Check your inbox and spam folder.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't resend the confirmation email. Please try again.");
    } finally {
      setResendBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (actualMode === "recovery") {
        const { error: cause } = await client.auth.updateUser({ password });
        if (cause) throw cause;
        onRecoveryDone(); onClose(); onMessage("Your password has been updated.");
      } else if (actualMode === "reset") {
        const { error: cause } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (cause) throw cause;
        setNotice("If an account exists for this email, a password-reset link is on its way. Open it to choose a new password.");
      } else if (actualMode === "signup") {
        const { data, error: cause } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (cause) throw cause;
        if (data.session) { onClose(); onMessage("Your account is ready. Make yourself heard."); }
        else setNotice("Check your email to confirm your account, then come back to sign in.");
      } else {
        const { error: cause } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (cause) throw cause;
        onClose(); onMessage("Welcome back to your voice studio.");
      }
      setPassword("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn't complete that request. Please try again."); }
    finally { setBusy(false); }
  }

  const title = { signin: "Welcome back.", signup: "Your voice belongs here.", reset: "Let's get you back in.", recovery: "Choose a new password." }[actualMode];
  return <Modal open={open} title={title} eyebrow="YOUR PRIVATE VOICE STUDIO" onClose={onClose}>
    <p className="modal-intro">{actualMode === "recovery" ? "Enter a new password for your VoiceBridge account." : actualMode === "reset" ? "Enter your account email and we'll send a secure reset link." : "Sign in to translate your voice notes and keep your creations in one private place."}</p>
    <form onSubmit={(event) => void submit(event)} className="auth-form">
      {actualMode !== "recovery" && <label className="field-label">Email address<div className="input-with-icon"><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required disabled={busy} /></div></label>}
      {actualMode !== "reset" && <label className="field-label">Password<div className="input-with-icon"><LockKeyhole size={17} /><input type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={actualMode === "signin" ? "Your password" : "At least 8 characters"} autoComplete={actualMode === "signin" ? "current-password" : "new-password"} minLength={actualMode === "signin" ? undefined : 8} required disabled={busy} /><button type="button" className="icon-button small" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
      {actualMode === "signin" && <div className="auth-help-actions">
        <button type="button" className="text-button forgot-button" onClick={() => { setMode("reset"); setError(""); setNotice(""); }}>Forgot password?</button>
        <button type="button" className="text-button resend-button" onClick={() => void resendConfirmation()} disabled={resendBusy || busy || !client}>
          {resendBusy ? <LoaderCircle size={14} className="spin" /> : null}{resendBusy ? "Sending…" : "Resend confirmation email"}
        </button>
      </div>}
      {error && <div className="inline-alert error" role="alert">{error}</div>}
      {notice && <div className="inline-alert success" role="status">{notice}</div>}
      <button className="button button-primary full-width" type="submit" disabled={busy || !client}>{busy ? <LoaderCircle size={17} className="spin" /> : null}{busy ? "One moment…" : { signin: "Sign in", signup: "Create account", reset: "Send reset link", recovery: "Update password" }[actualMode]}{!busy && <ArrowRight size={17} />}</button>
    </form>
    {actualMode !== "recovery" && <p className="auth-switch">{actualMode === "signin" ? "New around here?" : "Already have an account?"} <button className="text-button" onClick={() => { setMode(actualMode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}>{actualMode === "signin" ? "Create an account" : "Sign in"}</button></p>}
    <p className="fine-print"><LockKeyhole size={13} /> Your voice notes are stored privately in your account. Only translate voices you have permission to use.</p>
  </Modal>;
}
