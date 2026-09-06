import { Icon } from "../../ui/icon";
import { Message } from "./message";
import { FileMessage } from "./file-message";
import type { LocalMessage } from "./types";

export function SentMessage({ message }: { message: LocalMessage }) {
  return (
    <Message name="You" time={message.time} own>
      {message.text && (
        <div className="bubble">
          <p>{message.text}</p>
        </div>
      )}
      {message.attachment &&
        (message.attachment.kind === "image" ? (
          <a href={message.attachment.url} target="_blank" rel="noreferrer">
            <img
              className="sent-image"
              src={message.attachment.url}
              alt={message.attachment.name}
            />
          </a>
        ) : message.attachment.kind === "audio" ? (
          <audio className="sent-audio" controls src={message.attachment.url} />
        ) : message.attachment.kind === "video" ? (
          <video className="sent-video" controls src={message.attachment.url} />
        ) : (
          <FileMessage
            name={message.attachment.name}
            url={message.attachment.url}
            size={`${Math.max(1, Math.round(message.attachment.size / 1024))} KB`}
          />
        ))}
      <span className="delivery">
        <Icon name="check" size={13} /> Sent locally
      </span>
    </Message>
  );
}
