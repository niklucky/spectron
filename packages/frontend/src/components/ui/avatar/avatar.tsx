export function Avatar({
  initials,
  color = "sage",
  small = false,
}: {
  initials: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${color} ${small ? "avatar-small" : ""}`}>
      {initials}
    </span>
  );
}
