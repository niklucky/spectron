import { useRef } from "react";
import type { Ref } from "react";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/button";
import { Textarea } from "../../ui/input";
import type { Attachment } from "./types";
type ChatComposerProps = {
  project: string;
  taskId: string;
  draft: string;
  attachment: Attachment | undefined;
  recording: boolean;
  composeRef: Ref<HTMLTextAreaElement>;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onAttachFile: (file: File) => void;
  onRemoveAttachment: () => void;
  onToggleRecording: () => void;
};
export function ChatComposer({
  project,
  taskId,
  draft,
  attachment,
  recording,
  composeRef,
  onDraftChange,
  onSend,
  onAttachFile,
  onRemoveAttachment,
  onToggleRecording,
}: ChatComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="composer-area">
      <div className={`composer ${recording ? "is-recording" : ""}`}>
        {attachment && (
          <div className="attachment-preview">
            <Icon
              name={attachment.kind === "audio" ? "mic" : "file"}
              size={15}
            />
            <span>{attachment.name}</span>
            <IconButton
              icon="close"
              label="Remove attachment"
              onClick={onRemoveAttachment}
            />
          </div>
        )}
        <Textarea
          variant="plain"
          ref={composeRef}
          aria-label="Message"
          placeholder={`Message ${project}…`}
          rows={2}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div className="composer-toolbar">
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onAttachFile(file);
              event.target.value = "";
            }}
          />
          <IconButton
            icon="plus"
            label="Attach a file"
            onClick={() => fileRef.current?.click()}
          />
          <span className="composer-destination">
            <Icon name="hash" size={14} />
            {taskId}
          </span>
          {recording && (
            <span className="recording-label">
              <span />
              Recording…
            </span>
          )}
          <div className="composer-buttons">
            <IconButton
              icon={recording ? "pause" : "mic"}
              label={recording ? "Stop recording" : "Record voice message"}
              className={recording ? "recording-button" : ""}
              onClick={() => void onToggleRecording()}
            />
            <IconButton
              icon="arrow"
              label="Send message"
              className="send-button"
              disabled={(!draft.trim() && !attachment) || recording}
              onClick={onSend}
            />
          </div>
        </div>
      </div>
      <div className="composer-hint">
        Enter to send<span>·</span>Shift + Enter for a new line
      </div>
    </div>
  );
}
