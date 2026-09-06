import { Icon } from "../../ui/icon";

export function FileMessage({
  name,
  url,
  size,
}: {
  name: string;
  url: string;
  size: string;
}) {
  return (
    <a className="file-bubble" href={url} download={name}>
      <span className="file-icon">
        <Icon name="file" size={22} />
      </span>
      <span>
        <strong>{name}</strong>
        <small>{size}</small>
      </span>
      <Icon name="download" size={17} />
    </a>
  );
}
