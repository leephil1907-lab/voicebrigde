import { useEffect, useState } from "react";
import { ArrowRight, AudioLines, AudioWaveform, Check, ChevronDown, Globe2, Headphones, LockKeyhole, Mic2, MessageCircle, PhoneCall, Play, ShieldCheck, Sparkles, Upload, Waves, Menu, X } from "lucide-react";
import { Brand } from "./components/Brand";

const languages = ["English", "Español", "Français", "Português", "العربية", "Yorùbá", "日本語"];
const bars = [12,20,15,28,18,35,24,42,27,50,32,44,23,38,18,31,14,25,12,20,16,29,18,37,22,31,15,25,12,18,10,22,14,28,17,35,21,30,14,24];

export function MarketingHome() {
  const openStudio = () => { window.location.href = "/app"; };
  const [targetLanguage, setTargetLanguage] = useState("es");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const sampleTranslations: Record<string, { label: string; sample: string }> = {
    es: { label: "Spanish", sample: "Hola, ¿cómo estás?" },
    fr: { label: "French", sample: "Bonjour, comment allez-vous ?" },
    pt: { label: "Portuguese", sample: "Olá, como você está?" },
    yo: { label: "Yorùbá", sample: "Báwo ni? Ṣé àlàáfíà ni?" },
    ar: { label: "Arabic", sample: "مرحباً، كيف حالك؟" },
    ja: { label: "Japanese", sample: "こんにちは、お元気ですか？" },
  };
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>(".vb-reveal");
    if (!("IntersectionObserver" in window)) { nodes.forEach(node => node.classList.add("vb-visible")); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("vb-visible"); observer.unobserve(entry.target); }
    }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return <div className="vb-marketing">
    <header className="vb-site-header">
      <a className="vb-site-brand" href="/" aria-label="VoiceBridge home"><Brand /></a>
      <nav className="vb-site-nav" aria-label="Main navigation">
        <a href="#experience">Experience</a><a href="#how-it-works">How it works</a><a href="#trust">Your voice</a><a href="#faq">FAQ</a>
      </nav>
      <div className="vb-site-actions"><a className="vb-login-link" href="/app">Sign in</a><button className="vb-site-cta" onClick={openStudio}>Get started <ArrowRight size={16}/></button><button className="vb-menu-toggle" aria-label={mobileMenuOpen ? "Close menu" : "Open menu"} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(v => !v)}>{mobileMenuOpen ? <X size={19}/> : <Menu size={19}/>}</button></div>
      {mobileMenuOpen && <nav className="vb-mobile-menu" aria-label="Mobile navigation"><a href="#experience" onClick={() => setMobileMenuOpen(false)}>Experience</a><a href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it works</a><a href="#trust" onClick={() => setMobileMenuOpen(false)}>Your voice</a><a href="#faq" onClick={() => setMobileMenuOpen(false)}>FAQ</a><button onClick={openStudio}>Open VoiceBridge <ArrowRight size={16}/></button></nav>}
    </header>
    <main>
      <section className="vb-marketing-hero vb-reveal">
        <div className="vb-hero-copy">
          <div className="vb-marketing-eyebrow"><span/> SPEAK BEYOND LANGUAGE</div>
          <h1>Your voice.<br/><em>Without borders.</em></h1>
          <p className="vb-hero-lede">Say it in your language. Let them hear it in theirs. VoiceBridge helps your voice travel further while keeping the feeling of the original message.</p>
          <div className="vb-hero-buttons"><button className="vb-site-cta vb-site-cta-large" onClick={openStudio}>Try VoiceBridge <ArrowRight size={17}/></button><a className="vb-text-cta" href="#how-it-works"><span className="vb-play-icon"><Play size={13} fill="currentColor"/></span> See how it works</a></div>
          <div className="vb-hero-proof"><span><ShieldCheck size={15}/> Preview before sharing</span><span><Globe2 size={15}/> Made for many languages</span></div>
        </div>
        <div className="vb-hero-art" aria-label="Illustration of a voice message being translated">
          <div className="vb-art-glow"/>
          <div className="vb-art-orbit vb-orbit-one"/><div className="vb-art-orbit vb-orbit-two"/>
          <div className="vb-language-float vb-float-top"><span className="vb-language-dot"/> ENGLISH <ArrowRight size={13}/> {sampleTranslations[targetLanguage].label.toUpperCase()}</div>
          <div className="vb-voice-card">
            <div className="vb-voice-card-head"><span className="vb-avatar">V</span><div><strong>Your voice, translated</strong><small>Original recording · English</small></div><span className="vb-live-label">VOICE REFERENCE</span></div>
            <div className="vb-wave-display">{bars.map((h,i)=><i key={i} style={{height:h+"px"}}/>)}</div>
            <div className="vb-audio-meta"><span>00:18</span><span>Original voice</span></div>
            <div className="vb-translation-divider"><span/><Sparkles size={14}/><span/></div>
            <div className="vb-translated-row"><span className="vb-play-round"><Play size={14} fill="currentColor"/></span><div><strong>{sampleTranslations[targetLanguage].sample}</strong><small>{sampleTranslations[targetLanguage].label} · example translation</small></div><span className="vb-check-round"><Check size={13}/></span></div>
            <label className="vb-demo-select"><span>Preview language</span><select value={targetLanguage} onChange={e => setTargetLanguage(e.target.value)} aria-label="Preview translated language"><option value="es">Spanish</option><option value="fr">French</option><option value="pt">Portuguese</option><option value="yo">Yorùbá</option><option value="ar">Arabic</option><option value="ja">Japanese</option></select><ChevronDown size={13}/></label>
            <div className="vb-share-strip"><span><LockKeyhole size={13}/> Listen. Review. Share.</span><span><MessageCircle size={14}/> WhatsApp-ready sharing</span></div>
          </div>
          <div className="vb-language-float vb-float-bottom"><Globe2 size={15}/> One message. More ways to connect.</div>
          <div className="vb-art-caption">VOICE IDENTITY, KEPT IN THE CONVERSATION</div>
        </div>
      </section>
      <div className="vb-language-strip"><span>LET YOUR VOICE TRAVEL</span>{languages.map(x=><b key={x}>{x}</b>)}</div>
      <section className="vb-section vb-experience vb-reveal" id="experience">
        <div className="vb-section-heading"><div className="vb-marketing-eyebrow"><span/> A MORE HUMAN WAY TO CONNECT</div><h2>More than words.<br/><em>It’s how you say them.</em></h2><p>VoiceBridge brings your everyday voice messages and conversations closer, even when languages are different.</p></div>
        <div className="vb-feature-grid">
          <article className="vb-feature-card vb-feature-primary"><div className="vb-feature-icon"><AudioWaveform size={21}/></div><span className="vb-feature-number">01 / VOICE NOTES</span><h3>Keep the voice.<br/>Change the language.</h3><p>Record or upload audio, choose a destination language and create a translated voice note using the original recording as a voice reference.</p><div className="vb-feature-visual vb-note-visual"><div className="vb-mini-wave">{bars.slice(0,27).map((h,i)=><i key={i} style={{height:Math.max(8,h*.55)+"px"}}/>)}</div><span>English <ArrowRight size={13}/> Español</span></div></article>
          <article className="vb-feature-card"><div className="vb-feature-icon"><PhoneCall size={21}/></div><span className="vb-feature-number">02 / LIVE CALLS</span><h3>Closer conversations.</h3><p>Open the live-calling workspace for the calling capabilities currently available to your account.</p><div className="vb-feature-visual vb-call-visual"><span className="vb-call-avatar">A</span><span className="vb-call-wave"><Waves size={28}/></span><span className="vb-call-avatar vb-call-avatar-two">M</span></div></article>
          <article className="vb-feature-card"><div className="vb-feature-icon"><Headphones size={21}/></div><span className="vb-feature-number">03 / VOICE TO TEXT</span><h3>Understand every message.</h3><p>Turn an incoming voice recording into text and an English translation, so you can follow what was said.</p><div className="vb-feature-visual vb-text-visual"><span><AudioLines size={16}/> Incoming voice note</span><p>“It’s lovely to hear from you…”</p><small>English translation</small></div></article>
        </div>
      </section>
      <section className="vb-how-section vb-reveal" id="how-it-works"><div className="vb-how-inner"><div className="vb-section-heading vb-how-heading"><div className="vb-marketing-eyebrow"><span/> SIMPLE BY DESIGN</div><h2>From your voice<br/>to <em>theirs.</em></h2><p>A clear, considered workflow. You stay in control at every step.</p><button className="vb-site-cta" onClick={openStudio}>Create your first voice note <ArrowRight size={16}/></button></div><div className="vb-steps"><article><span>01</span><div className="vb-step-icon"><Mic2 size={20}/></div><h3>Speak naturally</h3><p>Record a message or upload an audio file from your device.</p></article><article><span>02</span><div className="vb-step-icon"><Globe2 size={20}/></div><h3>Choose a language</h3><p>Select the language you want your message translated into.</p></article><article><span>03</span><div className="vb-step-icon"><Sparkles size={20}/></div><h3>Create your version</h3><p>VoiceBridge processes the recording and prepares your translated audio.</p></article><article><span>04</span><div className="vb-step-icon"><Upload size={20}/></div><h3>Review and share</h3><p>Listen first, then choose how and where you want to share it.</p></article></div></div></section>
      <section className="vb-trust-section vb-reveal" id="trust"><div className="vb-trust-mark"><ShieldCheck size={25}/></div><div><div className="vb-marketing-eyebrow"><span/> YOUR VOICE, YOUR CHOICE</div><h2>Technology should<br/><em>sound like you.</em></h2><p>Your recording is the reference for your translated message. Review the result before sharing, and only process voices you own or have permission to use.</p><div className="vb-trust-points"><span><Check size={15}/> Consent-led voice processing</span><span><Check size={15}/> Private account-based notes</span><span><Check size={15}/> You choose when to share</span></div></div><div className="vb-trust-art"><div className="vb-trust-ring"><AudioWaveform size={48}/></div><span>YOUR VOICE<br/>GOES WITH YOU</span></div></section>
      <section className="vb-faq-section vb-reveal" id="faq">
        <div className="vb-faq-inner"><div className="vb-section-heading"><div className="vb-marketing-eyebrow"><span/> GOOD TO KNOW</div><h2>Questions,<br/><em>answered.</em></h2><p>What to expect when you bring your voice to VoiceBridge.</p></div>
          <div className="vb-faq-list">
            <details><summary>Does the translated message sound like me? <ChevronDown size={17}/></summary><p>VoiceBridge uses your original recording as a voice reference. How closely the translated output retains your voice depends on the source audio and provider capabilities.</p></details>
            <details><summary>Can I listen before sharing? <ChevronDown size={17}/></summary><p>Yes. Review your translated audio in VoiceBridge first. Sharing is a deliberate action you initiate from your device.</p></details>
            <details><summary>Which languages can I use? <ChevronDown size={17}/></summary><p>Available languages depend on the translation provider and current service configuration. The workspace shows the languages available to you.</p></details>
            <details><summary>Does VoiceBridge send messages automatically? <ChevronDown size={17}/></summary><p>No. VoiceBridge prepares audio for sharing. You select the recipient and confirm the action in the messaging app or device share sheet.</p></details>
          </div>
        </div>
      </section>
      <section className="vb-final-cta vb-reveal"><div className="vb-marketing-eyebrow"><span/> THE WORLD IS LISTENING</div><h2>Make every message<br/><em>feel closer.</em></h2><p>Start with one voice note. Discover a more natural way to connect across languages.</p><button className="vb-site-cta vb-site-cta-large" onClick={openStudio}>Enter VoiceBridge <ArrowRight size={17}/></button></section>
    </main>
    <footer className="vb-site-footer"><a href="/" className="vb-footer-brand"><Brand/></a><span>VoiceBridge · Your voice, beyond borders.</span><div><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="mailto:emmanuelramzey8@gmail.com">Contact</a><a href="/app">Open studio <ArrowRight size={13}/></a></div></footer>
  </div>;
}
