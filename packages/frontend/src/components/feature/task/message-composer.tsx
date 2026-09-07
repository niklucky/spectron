import type { ComponentProps, ReactNode } from "react";
import { Icon } from "../../ui/icon";
import type { useDictation } from "./use-dictation";

/** Shared surface and controls for new issues and issue conversations. */
export function MessageComposer({
  className = "",
  ...props
}: ComponentProps<"form">) {
  return <form {...props} className={`new-issue-composer ${className}`} />;
}
export function MessageComposerActions({
  preview,
  setPreview,
  language,
  setLanguage,
  voice,
  busy,
  canSend,
  children,
}: {
  preview: boolean;
  setPreview: (value: boolean) => void;
  language: string;
  setLanguage: (value: string) => void;
  voice: ReturnType<typeof useDictation>;
  busy: boolean;
  canSend: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="new-issue-actions">
      {children}
      <button
        type="button"
        className="message-preview-toggle"
        aria-pressed={preview}
        onClick={() => setPreview(!preview)}
      >
        {preview ? "Edit" : "Preview"}
      </button>
      <select
        className="dictation-language"
        aria-label="Dictation language"
        value={language}
        disabled={busy || voice.listening}
        onChange={(e) => setLanguage(e.target.value)}
      >
        <option value="en-US">EN</option>
        <option value="ru-RU">RU</option>
      </select>
      <button
        type="button"
        className={`new-issue-voice ${voice.listening ? "is-listening" : ""}`}
        aria-label={voice.listening ? "Stop dictation" : "Start voice input"}
        aria-pressed={voice.listening}
        disabled={busy}
        onClick={() => {
          setPreview(false);
          voice.toggle(language);
        }}
      >
        <Icon name={voice.listening ? "pause" : "mic"} size={19} />
      </button>
      <button
        type="submit"
        className="new-issue-send"
        aria-label="Send message"
        title="Send message"
        disabled={busy || voice.listening || !canSend}
      >
        <Icon name="arrow" size={20} />
      </button>
    </div>
  );
}
