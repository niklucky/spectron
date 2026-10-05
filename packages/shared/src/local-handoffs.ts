import type { AgentCommand, AgentRunScope } from "./agent-runs";

export const localApps = ["codex", "t3code"] as const;
export type LocalApp = (typeof localApps)[number];
export const localAppName = (app: LocalApp) =>
  app === "codex" ? "Codex" : "T3 Code";
export type LocalWorkspace = {
  repositoryId: string;
  originUrl: string;
  path: string;
};
export type LocalHandoffInput = AgentRunScope & {
  requestId: string;
  agentId: string;
  command: AgentCommand;
  repositoryId: string | null;
  message: string;
  fileIds: string[];
};
export type LocalHandoffView = AgentRunScope & {
  id: string;
  ownerId: string;
  ownerName: string;
  agentName: string;
  application: LocalApp;
  message: string;
  createdAt: string;
  launchRequestedAt: string | null;
  filesRevoked: boolean;
};
export type LocalHandoffDraft = {
  summary: string;
  originUrl: string | null;
  repositoryId: string | null;
  expiresAt: string;
};
export type LocalHandoffActions = {
  create: (input: LocalHandoffInput) => Promise<LocalHandoffView>;
  list: (scope: AgentRunScope) => Promise<LocalHandoffView[]>;
  draft: (input: AgentRunScope & { id: string }) => Promise<LocalHandoffDraft>;
  markLaunch: (input: AgentRunScope & { id: string }) => Promise<void>;
  revokeFiles: (input: AgentRunScope & { id: string }) => Promise<void>;
};

export function localAppLaunch(
  app: LocalApp,
  summary: string,
  workspace: Pick<LocalWorkspace, "path" | "originUrl">,
) {
  if (app === "t3code") return { url: "t3code://", prefilled: false };
  const params = new URLSearchParams();
  if (workspace.path) params.set("path", workspace.path);
  else if (workspace.originUrl) params.set("originUrl", workspace.originUrl);
  params.set("prompt", summary);
  const url = `codex://new?${params}`;
  // Large prompts still remain available to copy in full; do not silently truncate them.
  if (url.length <= 60000) return { url, prefilled: true };
  params.delete("prompt");
  return {
    url: `codex://threads/new${params.size ? `?${params}` : ""}`,
    prefilled: false,
  };
}

export function validLocalPath(path: string) {
  return (
    !path ||
    (path.length <= 4096 &&
      !/[\x00-\x1f\x7f]/.test(path) &&
      (/^\//.test(path) ||
        /^[A-Za-z]:[\\/]/.test(path) ||
        /^\\\\[^\\]+\\[^\\]+/.test(path)))
  );
}

export function validGitOrigin(value: string) {
  if (!value) return true;
  if (value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  if (/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      ["https:", "ssh:"].includes(url.protocol) &&
      !!url.hostname &&
      !url.password &&
      (url.protocol === "ssh:" || !url.username)
    );
  } catch {
    return false;
  }
}
