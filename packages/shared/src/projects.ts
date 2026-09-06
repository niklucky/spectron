export type CreateProjectInput = {
  name: string;
  key: string;
  url?: string | null;
  logo?: string | null;
};
export type ProjectSummary = {
  id: string;
  name: string;
  key: string;
  url: string | null;
  logo: string | null;
  state: "active" | "archived";
  role: "owner" | "member";
  createdAt: string;
  updatedAt: string;
};
export function normalizeProjectURL(value: string | null): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const url = new URL(
    /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 2048
  )
    throw new Error("Enter a valid HTTP or HTTPS website URL.");
  url.hash = "";
  return url.href;
}

export type ProjectMemberSummary = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  joinedAt: string;
};
export type InvitationSummary = {
  id: string;
  email: string;
  status:
    | "sending"
    | "pending"
    | "accepted"
    | "cancelled"
    | "expired"
    | "failed";
  createdAt: string;
  expiresAt: string;
};
export type InvitationPreview = {
  projectId: string;
  projectName: string;
  logo: string | null;
  status: "pending" | "accepted";
};
