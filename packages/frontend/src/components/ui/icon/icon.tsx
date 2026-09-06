const paths = {
  chats:
    "M4 3h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 1-2z M18 8h2a2 2 0 0 1 2 2v11l-4-3h-6a2 2 0 0 1-2-2",
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  sidebar:
    "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M9 3v18",
  issues: "M8 4h13 M8 12h13 M8 20h13 M3 4h.01 M3 12h.01 M3 20h.01",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3l-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-1 1-3 3-2-1-3-3-1-1-3z",
  plus: "M12 5v14 M5 12h14",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5",
  chevron: "M8 10l4 4 4-4",
  back: "M15 5l-7 7 7 7",
  arrow: "M12 19V5 M6 11l6-6 6 6",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  paperclip:
    "M8 12l7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3 M5 17a2 2 0 0 0 3 3L19 9",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
  play: "M8 5l11 7-11 7z",
  pause: "M8 5v14 M16 5v14",
  file: "M14 2H5v20h14V7z M14 2v5h5 M8 12h8 M8 16h5",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  close: "M6 6l12 12 M18 6L6 18",
  check: "M5 12l4 4L19 6",
  checks: "M2 12l4 4L16 6 M11 15l2 2L23 7",
  hash: "M10 3L6 21 M18 3l-4 18 M4 8h17 M3 16h17",
  moon: "M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1",
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M4 21v-3a8 5 0 0 1 16 0v3",
  globe:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M2 12h20 M12 2a20 20 0 0 0 0 20 20 20 0 0 0 0-20",
  logout: "M9 3H3v18h6 M8 12h13 M17 8l4 4-4 4",
  branch: "M6 3v12a4 4 0 0 0 4 4h8 M18 3v10 M15 10l3 3 3-3",
  github:
    "M9 19c-4 1-4-2-6-2 M9 22v-4c-4-1-6-3-6-6 0-2 1-4 2-5L5 3l4 2a13 13 0 0 1 6 0l4-2v4c1 1 2 3 2 5 0 3-2 5-6 6v4",
  gitlab:
    "M12 21L2 13 5 3l3 8h8l3-8 3 10z M8 11l4 10 4-10 M2 13l6-2 M16 11l6 2",
  telegram: "M22 3L2 11l7 3 3 7 3-6 5 4z M9 14l9-7 M12 21v-6l6-8",
  slack: "M8 3v11 M3 8h11 M16 10v11 M10 16h11 M3 16h1 M8 20v1 M20 8h1 M16 3v1",
  jira: "M12 2l10 10-10 10L2 12z M12 8l4 4-4 4-4-4z",
  link: "M10 13l4-4 M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M13 11a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2",
  volume: "M3 9h4l5-5v16l-5-5H3z M16 8a6 6 0 0 1 0 8 M19 4a11 11 0 0 1 0 16",
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
