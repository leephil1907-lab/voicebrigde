export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <path d="M5.5 25.5C9.2 13.8 14.2 8 20 8s10.8 5.8 14.5 17.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".42" />
        <path d="M8 27.5C11.1 19.4 15.1 15.4 20 15.4s8.9 4 12 12.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity=".7" />
        <g className="brand-wave-bar" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round">
          <path d="M7 22v5" />
          <path d="M13.5 17v14" />
          <path d="M20 12v21" />
          <path d="M26.5 17v14" />
          <path d="M33 22v5" />
        </g>
        <path d="M12 34h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </svg>
    </span>
  );
}

export function Brand() {
  return <div className="brand"><BrandMark /><div><span className="brand-name">voicebridge<span className="brand-dot">.</span></span><span className="brand-caption">YOUR VOICE. EVERY LANGUAGE.</span></div></div>;
}

export function LanguageBadge({ code }: { code: string }) {
  const normalized = code.trim().slice(0, 3).toUpperCase() || "N/A";
  return <span className="language-code-badge" aria-label={`Language code ${normalized}`}>{normalized}</span>;
}

export function SpanishFlag() {
  return <svg className="spanish-flag" viewBox="0 0 30 22" aria-label="Spanish flag" role="img"><rect width="30" height="22" rx="4" fill="#e7ad39" /><path d="M0 5.5h30v11H0z" fill="#c64b45" /><path d="M8 8h4v5.5a2 2 0 0 1-4 0z" fill="#f4d58b" /><path d="M8 7h4M9 6v1M11 6v1" stroke="#f4d58b" strokeWidth="1.2" /></svg>;
}

export function SoundGlobe({ language = "ES" }: { language?: string }) {
  return <div className="sound-globe" aria-hidden="true">
    <svg viewBox="0 0 260 180" fill="none">
      <circle cx="135" cy="87" r="68" fill="#edf1e5" />
      <g stroke="#a8b798" strokeWidth="1"><circle cx="135" cy="87" r="57" /><ellipse cx="135" cy="87" rx="28" ry="57" /><ellipse cx="135" cy="87" rx="57" ry="22" /><path d="M78 87h114M135 30v114" /></g>
      <circle className="sound-globe-orbit" cx="135" cy="87" r="78" stroke="#cad4bd" strokeDasharray="3 6" />
      <rect className="sound-globe-core" x="103" y="61" width="65" height="51" rx="19" fill="#193b32" />
      <path d="M119 108l-3 13 17-11" fill="#193b32" />
      <g stroke="#d5ef8b" strokeWidth="3.4" strokeLinecap="round"><path d="M118 82v9M127 75v23M136 70v33M145 78v17M154 83v7" /></g>
      <rect x="174" y="111" width="48" height="33" rx="11" fill="#d5ef8b" stroke="#f7f8f4" strokeWidth="4" />
      <text x="198" y="133" textAnchor="middle" fill="#193b32" fontSize="12" fontWeight="800" fontFamily="Manrope Variable, sans-serif">{language.slice(0, 3)}</text>
      <circle cx="69" cy="57" r="7" fill="#d5ef8b" stroke="#f7f8f4" strokeWidth="4" /><circle cx="195" cy="44" r="4" fill="#7c9574" />
      <path d="M43 115l4-7 4 7-4 7zM215 80v10M210 85h10" stroke="#9eaf8d" strokeWidth="1.5" />
    </svg>
  </div>;
}
