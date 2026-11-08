import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  client: SupabaseClient | null;
  recovery: boolean;
  onClose: () => void;
  onRecoveryDone: () => void;
  onMessage: (message: string) => void;
}

type AuthMode = "signin" | "signup" | "reset";

export function AuthDialog({ open, client, recovery, onClose, onRecoveryDone, onMessage }: Props) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const actualMode = recovery ? "recovery" : mode;
  const passwordChecks = useMemo(() => ({
    length: password.length >= 8,
    letter: /[A-Za-z]/.test(password),
    number: /\d/.test(password),
  }), [password]);
  const passwordValid = Object.values(passwordChecks).every(Boolean);

  useEffect(() => {
    if (open) {
      setError("");
      setNotice("");
      setPassword("");
      setConfirmPassword("");
    }
  }, [open, recovery]);

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
    setVisible(false);
  };

  async function resendConfirmation() {
    if (!client || resendBusy || !email.trim()) {
      setError("Enter your account email address first.");
      return;
    }
    setResendBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: cause } = await client.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (cause) throw cause;
      setNotice("If this account is awaiting confirmation, a fresh verification email has been requested. Check your inbox and spam folder.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't resend the verification email. Please try again.");
    } finally {
      setResendBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client || busy) return;
    setError("");
    setNotice("");

    if (actualMode !== "signin" && actualMode !== "reset" && !passwordValid) {
      setError("Use at least 8 characters, including a letter and a number.");
      return;
    }
    if (actualMode === "signup" && password !== confirmPassword) {
      setError("Your passwords don't match. Check both fields and try again.");
      return;
    }
    if (actualMode === "signup" && !termsAccepted) {
      setError("Please accept the Terms and Privacy Policy to create your account.");
      return;
    }

    setBusy(true);
    try {
      if (actualMode === "recovery") {
        const { error: cause } = await client.auth.updateUser({ password });
        if (cause) throw cause;
        onRecoveryDone();
        onClose();
        onMessage("Your password has been updated. You can sign in with your new password.");
      } else if (actualMode === "reset") {
        const { error: cause } = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (cause) throw cause;
        setNotice("If an account exists for this email, a secure password-reset link is on its way. Open it to choose a new password.");
      } else if (actualMode === "signup") {
        const { data, error: cause } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (cause) throw cause;
        if (data.session) {
          onClose();
          onMessage("Your VoiceBridge account is ready. Make yourself heard.");
        } else {
          setNotice("Your account has been created. Check your inbox for a verification link, then return here to sign in.");
        }
      } else {
        const { error: cause } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (cause) throw cause;
        onClose();
        onMessage("Welcome back to your voice studio.");
      }
      setPassword("");
      setConfirmPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't complete that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = {
    signin: "Welcome back.",
    signup: "Your voice belongs here.",
    reset: "Let's get you back in.",
    recovery: "Choose a new password.",
  }[actualMode];

  return (
    <Modal open={open} title={title} eyebrow="VOICEBRIDGE AI · YOUR PRIVATE VOICE STUDIO" onClose={onClose} wide>
      <div className="auth-layout">
        <aside className="auth-visual">
          <span className="auth-visual-mark"><Volume2 size={24} /></span>
          <span className="auth-visual-kicker">SOUND LIKE YOU. SPEAK EVERYWHERE.</span>
          <h3>Your voice,<br /><em>without borders.</em></h3>
          <p>Translate the way you speak, keep the expression that makes it yours, and share with confidence.</p>
          <div className="auth-visual-points">
            <span><ShieldCheck size={16} /> Private by design</span>
            <span><Sparkles size={16} /> Voice-first translation</span>
            <span><LockKeyhole size={16} /> Secure account access</span>
          </div>
          <div className="auth-visual-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        </aside>

        <section className="auth-content">
          <p className="auth-content-intro">
            {actualMode === "recovery"
              ? "Set a strong password to secure your account."
              : actualMode === "reset"
                ? "Enter your account email and we'll send you a secure recovery link."
                : actualMode === "signup"
                  ? "Create your account and keep every translation in one private place."
                  : "Sign in to translate your voice notes and pick up where you left off."}
          </p>

          <form onSubmit={(event) => void submit(event)} className="auth-form" noValidate>
            {actualMode !== "recovery" && (
              <label className="auth-field">
                <span>Email address</span>
                <div className="auth-input-wrap">
                  <Mail size={17} />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    disabled={busy}
                  />
                </div>
              </label>
            )}

            {actualMode !== "reset" && (
              <label className="auth-field">
                <span>{actualMode === "signin" ? "Password" : "Create password"}</span>
                <div className="auth-input-wrap">
                  <LockKeyhole size={17} />
                  <input
                    type={visible ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={actualMode === "signin" ? "Enter your password" : "At least 8 characters"}
                    autoComplete={actualMode === "signin" ? "current-password" : "new-password"}
                    minLength={actualMode === "signin" ? undefined : 8}
                    required
                    disabled={busy}
                  />
                  <button type="button" className="auth-visibility" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
            )}

            {(actualMode === "signup" || actualMode === "recovery") && (
              <>
                <div className="auth-password-checks" aria-live="polite">
                  <span className={passwordChecks.length ? "valid" : ""}><Check size={13} /> 8 characters</span>
                  <span className={passwordChecks.letter ? "valid" : ""}><Check size={13} /> A letter</span>
                  <span className={passwordChecks.number ? "valid" : ""}><Check size={13} /> A number</span>
                </div>
                {actualMode === "signup" && (
                  <label className="auth-field">
                    <span>Confirm password</span>
                    <div className="auth-input-wrap">
                      <LockKeyhole size={17} />
                      <input
                        type={visible ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Enter your password again"
                        autoComplete="new-password"
                        minLength={8}
                        required
                        disabled={busy}
                      />
                    </div>
                  </label>
                )}
              </>
            )}

            {actualMode === "signin" && (
              <div className="auth-help-actions">
                <button type="button" className="auth-text-button" onClick={() => changeMode("reset")}>Forgot password?</button>
                <button type="button" className="auth-text-button subtle" onClick={() => void resendConfirmation()} disabled={resendBusy || busy || !client}>
                  {resendBusy ? <LoaderCircle size={14} className="spin" /> : null}
                  {resendBusy ? "Sending…" : "Resend verification"}
                </button>
              </div>
            )}

            {actualMode === "signup" && (
              <label className="auth-terms">
                <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} disabled={busy} />
                <span>I agree to the <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
              </label>
            )}

            {error && <div className="auth-feedback error" role="alert">{error}</div>}
            {notice && (
              <div className="auth-feedback success" role="status">
                {notice}
                {actualMode === "signup" && (
                  <button type="button" className="auth-text-button" onClick={() => void resendConfirmation()} disabled={resendBusy || busy}>
                    {resendBusy ? "Sending…" : "Resend verification email"}
                  </button>
                )}
              </div>
            )}

            <button className="button button-primary auth-submit" type="submit" disabled={busy || !client}>
              {busy ? <LoaderCircle size={17} className="spin" /> : null}
              {busy ? "Please wait…" : { signin: "Sign in", signup: "Create account", reset: "Send recovery link", recovery: "Update password" }[actualMode]}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          {actualMode !== "recovery" && (
            <div className="auth-switch">
              {actualMode === "signin" ? "New to VoiceBridge?" : "Already have an account?"}
              <button className="auth-text-button" onClick={() => changeMode(actualMode === "signin" ? "signup" : "signin")}>
                {actualMode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </div>
          )}
          {actualMode === "reset" && (
            <button type="button" className="auth-back-link" onClick={() => changeMode("signin")}><ArrowLeft size={14} /> Back to sign in</button>
          )}
          <p className="auth-footnote"><LockKeyhole size={13} /> Your recordings stay private to your account.</p>
        </section>
      </div>
    </Modal>
  );
}
