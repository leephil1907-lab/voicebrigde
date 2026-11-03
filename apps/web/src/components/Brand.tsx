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
  const bars = [18, 26, 16, 36, 53, 32, 65, 43, 74, 52, 62, 37, 50, 30, 42, 20, 29];
  return <div className="sound-globe" aria-hidden="true">
    <svg viewBox="0 0 280 180" fill="none">
      <rect x="31" y="16" width="218" height="147" rx="25" fill="#f4f3f0" stroke="#e4e3de" />
      <rect x="44" y="29" width="192" height="122" rx="17" fill="#fff" stroke="#ebeae5" />
      <circle cx="59" cy="44" r="3" fill="#b7b8af"/><circle cx="70" cy="44" r="3" fill="#d6d8d0"/><circle cx="81" cy="44" r="3" fill="#d6d8d0"/>
      <g fill="#252722">{bars.map((height, index) => <rect key={index} x={59 + index * 9.3} y={100 - height / 2} width="4" height={height} rx="2" opacity={index < 8 ? '.34' : '.85'} />)}</g>
      <rect x="184" y="130" width="55" height="33" rx="11" fill="#252722" />
      <text x="211.5" y="151" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="Manrope Variable, sans-serif">{language.slice(0,3)}</text>
      <circle cx="41" cy="133" r="16" fill="#e8f0e4" stroke="#fff" strokeWidth="4" />
      <path d="M35 133h12M38 129v8M42 127v12M46 130v6" stroke="#456958" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  </div>;
}
