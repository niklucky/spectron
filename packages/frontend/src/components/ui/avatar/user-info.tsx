import { Avatar, type AvatarKind, type AvatarSize } from "./avatar";
import { cn } from "../cn";
export function UserInfo({
  name,
  image,
  label,
  avatarOnly = false,
  kind = "person",
  size = "sm",
  className = "",
}: {
  name: string;
  image?: string | null | undefined;
  label?: string | undefined;
  avatarOnly?: boolean | undefined;
  kind?: AvatarKind | undefined;
  size?: AvatarSize | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 align-middle",
        className,
      )}
      title={label ? `${label}: ${name}` : name}
      aria-label={label ? `${label}: ${name}` : name}
    >
      <Avatar name={name} image={image} size={size} kind={kind} />
      {!avatarOnly && (
        <span className="truncate font-medium text-ink">{name}</span>
      )}
    </span>
  );
}
