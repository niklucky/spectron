export const gitProviders = ["github", "gitlab"] as const;
export type GitProvider = (typeof gitProviders)[number];
export type GitActor = { id: string; login: string; name: string; email: string | null };
export type GitConnectionInput = { name: string; provider: GitProvider; baseURL: string; token: string };
export type GitConnectionSummary = {
  id: string; projectId: string; creatorId: string; name: string; provider: GitProvider;
  baseURL: string; revision: number; actor: GitActor | null;
  commitAuthorName: string; commitAuthorEmail: string;
  checkStatus: "untested" | "passed" | "failed"; checkedAt: string | null; createdAt: string;
};
export type GitRemoteRepository = {
  externalId: string; fullName: string; webURL: string; cloneURL: string;
  defaultBranch: string | null; archived: boolean;
};
export type GitRepository = GitRemoteRepository & {
  id: string; projectId: string; connectionId: string; provider: GitProvider;
  targetBranch: string; isDefault: boolean; revision: number;
};
export type GitPage<T> = { items: T[]; nextPage: number | null };
export type GitConnectionRef = { projectId: string; id: string; revision: number };
