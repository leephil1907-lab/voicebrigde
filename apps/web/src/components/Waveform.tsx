interface WaveformProps { peaks: number[]; progress?: number; live?: boolean; className?: string }

export function Waveform({ peaks, progress = -1, live = false, className = "" }: WaveformProps) {
  const count = peaks.length || 64;
  return <svg className={`waveform ${live ? "is-live" : ""} ${className}`} viewBox="0 0 640 100" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="50" x2="640" y2="50" stroke="currentColor" opacity="0.12" strokeDasharray="2 5" />
    {peaks.map((peak, index) => {
      const height = Math.max(5, Math.min(88, peak * 88));
      return <rect key={index} x={index * (640 / count) + 2} y={(100 - height) / 2} width={Math.max(2, 640 / count - 5)} height={height} rx="2.5" fill="currentColor" opacity={progress >= 0 && index / count > progress ? 0.25 : live ? 0.45 + peak * 0.55 : 0.8} />;
    })}
  </svg>;
}
