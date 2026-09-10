import { useState } from "react";
import { Avatar } from "./avatar";
export function UserInfo({
  name,
  image,
  label,
  avatarOnly = false,
}: {
  name: string;
  image?: string | null | undefined;
  label?: string;
  avatarOnly?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className="user-info"
      title={label ? `${label}: ${name}` : name}
      aria-label={label ? `${label}: ${name}` : name}
    >
      {image && failed !== image ? (
        <img src={image} alt="" onError={() => setFailed(image)} />
      ) : (
        <Avatar
          name={name}
          initials={
            name
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase() || "?"
          }
          small
        />
      )}
      {!avatarOnly && <span className="user-info-name">{name}</span>}
    </span>
  );
}
