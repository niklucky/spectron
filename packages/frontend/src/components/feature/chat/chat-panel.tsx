import type { ReactNode, Ref } from "react";
import { Icon } from "../../ui/icon";
import { SentMessage } from "./sent-message";
import { DayDivider } from "./message";
import type { LocalMessage } from "./types";
export function ChatPanel({
  header,
  composer,
  children,
}: {
  header: ReactNode;
  composer: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="chat-panel" aria-label="Task conversation">
      {header}
      {children}
      {composer}
    </main>
  );
}
export function ChatTimeline({
  title,
  historyRef,
  endRef,
  messages,
  children,
}: {
  title: string;
  historyRef: Ref<HTMLDivElement>;
  endRef: Ref<HTMLDivElement>;
  messages: LocalMessage[];
  children?: ReactNode;
}) {
  return (
    <div className="chat-history" ref={historyRef}>
      <div className="conversation">
        {children || (
          <>
            <DayDivider>Today</DayDivider>
            <div className="conversation-start">
              <span className="conversation-start-icon">
                <Icon name="hash" size={23} />
              </span>
              <h3>{title}</h3>
              <p>This is the start of this task’s conversation.</p>
            </div>
          </>
        )}
        {messages.map((message) => (
          <SentMessage key={message.id} message={message} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
