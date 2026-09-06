import { Icon } from "../../ui/icon";
export function VideoPreview({
  poster,
  title,
  duration,
  label,
  onPlay,
}: {
  poster: string;
  title: string;
  duration: string;
  label?: string;
  onPlay: () => void;
}) {
  return (
    <button
      className="video-preview"
      onClick={onPlay}
      aria-label={label || `Play ${title}`}
    >
      <img src={poster} alt={`Preview of ${title}`} />
      <span className="video-shade" />
      <span className="video-play">
        <Icon name="play" size={22} />
      </span>
      <span className="video-bottom">
        <span>{title}</span>
        <span>{duration}</span>
      </span>
    </button>
  );
}
