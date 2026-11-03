export function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path className="brand-wave-bar bar-1" d="M5 13v6" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" /><path className="brand-wave-bar bar-2" d="M10.5 8v16" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" /><path className="brand-wave-bar bar-3" d="M16 4v24" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" /><path className="brand-wave-bar bar-4" d="M21.5 10v12" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" /><path className="brand-wave-bar bar-5" d="M27 13v6" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" /></svg></span>;
}

export function Brand() {
  return <div className="brand"><BrandMark /><div><span className="brand-name">voicebridge<span className="brand-dot">.</span></span><span className="brand-caption">YOUR VOICE. EVERY LANGUAGE.</span></div></div>;
}

export function SpanishFlag() {
  return <svg className="spanish-flag" viewBox="0 0 30 22" aria-label="Spanish flag" role="img"><rect width="30" height="22" rx="4" fill="#e7ad39" /><path d="M0 5.5h30v11H0z" fill="#c64b45" /><path d="M8 8h4v5.5a2 2 0 0 1-4 0z" fill="#f4d58b" /><path d="M8 7h4M9 6v1M11 6v1" stroke="#f4d58b" strokeWidth="1.2" /></svg>;
}

export function SoundGlobe() {
  return <div className="sound-globe" aria-hidden="true">
    <svg viewBox="0 0 260 180" fill="none">
      <circle cx="135" cy="87" r="68" fill="#edf1e5" />
      <g stroke="#a8b798" strokeWidth="1"><circle cx="135" cy="87" r="57" /><ellipse cx="135" cy="87" rx="28" ry="57" /><ellipse cx="135" cy="87" rx="57" ry="22" /><path d="M78 87h114M135 30v114" /></g>
      <circle cx="135" cy="87" r="78" stroke="#cad4bd" strokeDasharray="3 6" />
      <rect x="103" y="61" width="65" height="51" rx="19" fill="#193b32" />
      <path d="M119 108l-3 13 17-11" fill="#193b32" />
      <g stroke="#d5ef8b" strokeWidth="3.4" strokeLinecap="round"><path d="M118 82v9M127 75v23M136 70v33M145 78v17M154 83v7" /></g>
      <rect x="174" y="111" width="48" height="33" rx="11" fill="#d5ef8b" stroke="#f7f8f4" strokeWidth="4" />
      <text x="198" y="133" textAnchor="middle" fill="#193b32" fontSize="13" fontWeight="800" fontFamily="Manrope Variable, sans-serif">ES</text>
      <circle cx="69" cy="57" r="7" fill="#d5ef8b" stroke="#f7f8f4" strokeWidth="4" /><circle cx="195" cy="44" r="4" fill="#7c9574" />
      <path d="M43 115l4-7 4 7-4 7zM215 80v10M210 85h10" stroke="#9eaf8d" strokeWidth="1.5" />
    </svg>
  </div>;
}
