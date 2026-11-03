import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, RotateCw, Volume2 } from "lucide-react";
import { formatTime, SILENT_PEAKS } from "../lib/audio";
import { Waveform } from "./Waveform";

interface Props {
  src: string;
  label: string;
  peaks?: number[];
  durationHint?: number;
  translated?: boolean;
  onDownload?: () => void;
  onRefresh?: () => void;
}

export function AudioPlayer({ src, label, peaks = SILENT_PEAKS, durationHint = 0, translated = false, onDownload, onRefresh }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(durationHint);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    setPlaying(false); setCurrent(0); setDuration(durationHint); setError(""); setRate(1);
    const audio = audioRef.current;
    const pauseOther = (event: Event) => { if ((event as CustomEvent<HTMLAudioElement>).detail !== audio) audio?.pause(); };
    document.addEventListener("voicebridge:play", pauseOther);
    return () => { document.removeEventListener("voicebridge:play", pauseOther); audio?.pause(); };
  }, [src, durationHint]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try { setError(""); document.dispatchEvent(new CustomEvent("voicebridge:play", { detail: audio })); await audio.play(); }
      catch { setError("Playback couldn't start. Try again, or download the audio to listen in another player."); }
    } else audio.pause();
  }

  function changeRate() {
    const rates = [1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(rate) + 1) % rates.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  return <div className={`audio-player ${translated ? "translated-player" : ""}`} aria-label={label}>
    <audio ref={audioRef} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={() => setCurrent(audioRef.current?.currentTime || 0)} onLoadedMetadata={() => { const value = audioRef.current?.duration; if (value && Number.isFinite(value)) setDuration(value); }} onError={() => setError("This audio couldn't be loaded. Refresh the preview or try another recording.")} />
    <div className="player-main">
      <button className="play-button" onClick={() => void toggle()} aria-label={playing ? `Pause ${label}` : `Play ${label}`}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
      <div className="player-wave"><Waveform peaks={peaks} progress={duration ? current / duration : 0} /><input className="seek-range" type="range" min="0" max={duration || 1} step="0.05" value={Math.min(current, duration || 1)} disabled={!duration} aria-label={`Seek ${label}`} onChange={(event) => { const value = Number(event.target.value); if (audioRef.current) { audioRef.current.currentTime = value; setCurrent(value); } }} /></div>
      <span className="player-time">{formatTime(current)}<span> / {formatTime(duration)}</span></span>
    </div>
    <div className="player-footer"><span className="player-format"><Volume2 size={13} /> {translated ? "Translated · OGG audio" : "Original recording"}</span><div className="flex items-center gap-2"><button className="speed-button" onClick={changeRate} aria-label={`Playback speed ${rate} times. Click to change.`}>{rate}×</button>{onRefresh && <button className="icon-button small" onClick={onRefresh} aria-label="Refresh preview link" title="Refresh preview link"><RotateCw size={15} /></button>}{onDownload && <button className="icon-button small" onClick={onDownload} aria-label={`Download ${label}`} title="Download audio"><Download size={16} /></button>}</div></div>
    {error && <p className="player-error" role="alert">{error}</p>}
  </div>;
}
