import {
  validGitOrigin,
  validLocalPath,
  type GitRepository,
  type LocalWorkspace,
} from "@spectron/shared";
const key = (userId: string, projectId: string, repositoryId: string) =>
  `spectron:local-workspace:${userId}:${projectId}:${repositoryId || "default"}`;
const selectionKey = (userId: string, projectId: string) =>
  `spectron:local-workspace:${userId}:${projectId}:selected`;
export function readLocalWorkspace(
  userId: string,
  projectId: string,
  repositoryId?: string | null,
): LocalWorkspace {
  // Handoffs without a linked repository follow the project's current choice.
  // An explicit empty string still reads the separate, unlinked folder binding.
  if (repositoryId == null) {
    try {
      repositoryId =
        localStorage.getItem(selectionKey(userId, projectId)) ?? "";
    } catch {
      repositoryId = "";
    }
  }
  const empty = { repositoryId, originUrl: "", path: "" };
  try {
    const value = JSON.parse(
      localStorage.getItem(key(userId, projectId, repositoryId)) || "null",
    );
    return value &&
      typeof value.path === "string" &&
      typeof value.originUrl === "string" &&
      typeof value.repositoryId === "string" &&
      validLocalPath(value.path) &&
      validGitOrigin(value.originUrl)
      ? value
      : empty;
  } catch {
    return empty;
  }
}
export function preferredLocalRepositoryId(
  workspace: LocalWorkspace,
  repositories: Pick<GitRepository, "id" | "isDefault">[],
): string | null {
  if (repositories.some((repo) => repo.id === workspace.repositoryId))
    return workspace.repositoryId;
  if (!workspace.repositoryId && (workspace.path || workspace.originUrl))
    return null;
  return (
    repositories.find((repo) => repo.isDefault)?.id ??
    (repositories.length === 1 ? repositories[0]!.id : null)
  );
}
export function saveLocalWorkspace(
  userId: string,
  projectId: string,
  workspace: LocalWorkspace,
) {
  if (!validLocalPath(workspace.path))
    throw new Error(
      "Enter an absolute folder path, such as /Users/me/code/project or C:\\code\\project.",
    );
  if (!validGitOrigin(workspace.originUrl))
    throw new Error(
      "Enter an HTTPS or SSH Git remote without a password or token.",
    );
  localStorage.setItem(
    key(userId, projectId, workspace.repositoryId),
    JSON.stringify(workspace),
  );
  // Remember the preferred repository for the project's next handoff.
  localStorage.setItem(selectionKey(userId, projectId), workspace.repositoryId);
  window.dispatchEvent(new Event("spectron:local-workspace"));
}
