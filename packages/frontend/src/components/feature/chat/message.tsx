import type { ReactNode } from "react";
import type { IconName } from "../../ui/icon";
import { Icon } from "../../ui/icon";
import { Avatar } from "../../ui/avatar";

export function Message({
  children,
  name,
  time,
  source,
  own = false,
  initials = "AM",
  color = "sand",
}: {
  children: ReactNode;
  name: string;
  time: string;
  source?: IconName;
  own?: boolean;
  initials?: string;
  color?: string;
}) {
  return (
    <article className={`message ${own ? "message-own" : ""}`}>
      {!own && <Avatar initials={initials} color={color} />}
      <div className="message-content">
        <div className="message-meta">
          <span>{name}</span>
          {source && (
            <span
              className={`message-source source-${source}`}
              title={`From ${source}`}
              aria-label={`From ${source}`}
            >
              <Icon name={source} size={13} />
            </span>
          )}
          <time>{time}</time>
        </div>
        {children}
      </div>
    </article>
  );
}

export function MessageBubble({ children }: { children: ReactNode }) {
  return <div className="bubble">{children}</div>;
}
export function DayDivider({ children }: { children: ReactNode }) {
  return (
    <div className="day-divider">
      <span>{children}</span>
    </div>
  );
}
