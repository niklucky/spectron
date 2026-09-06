import { useRef, useState } from "react";
import { IconButton } from "../../ui/button";

const bars = Array.from(
  { length: 48 },
  (_, index) => 5 + ((index * 17 + index * index * 3) % 24),
);
const formatTime = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

export function VoiceMessage({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(12);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState(false);
  const toggle = () => {
    if (!audio.current) return;
    if (playing) audio.current.pause();
    else void audio.current.play().catch(() => setError(true));
  };
  return (
    <div className="voice-bubble">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => setDuration(audio.current?.duration || 12)}
        onTimeUpdate={() => setCurrentTime(audio.current?.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => setError(true)}
      />
      <IconButton
        icon={playing ? "pause" : "play"}
        label={playing ? "Pause voice message" : "Play voice message"}
        className="voice-play"
        onClick={toggle}
      />
      <div className="voice-track">
        <div className="waveform" aria-hidden="true">
          {bars.map((height, index) => (
            <span
              key={index}
              style={{
                height,
                opacity:
                  currentTime / duration > index / bars.length ? 1 : 0.35,
              }}
            />
          ))}
        </div>
        <div className="voice-caption">
          <span>{error ? "Audio unavailable" : "Voice message"}</span>
          <span>{formatTime(playing ? currentTime : duration)}</span>
        </div>
      </div>
    </div>
  );
}
