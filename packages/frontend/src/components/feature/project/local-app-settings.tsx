import { useEffect, useState } from "react";
import type { GitRepository, LocalWorkspace } from "@spectron/shared";
import {
  readLocalWorkspace,
  saveLocalWorkspace,
} from "../../../lib/local-workspace";
import { Button } from "../../ui/button";

export function LocalAppSettings({
  projectId,
  userId,
  repositories,
}: {
  projectId: string;
  userId: string;
  repositories: (projectId: string) => Promise<GitRepository[]>;
}) {
  const [repos, setRepos] = useState<GitRepository[]>([]);
  const [workspace, setWorkspace] = useState<LocalWorkspace>(() =>
    readLocalWorkspace(userId, projectId),
  );
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void repositories(projectId)
      .then((rows) => {
        if (!alive) return;
        setRepos(rows);
        const previous = readLocalWorkspace(userId, projectId);
        const configured =
          previous.repositoryId || previous.path || previous.originUrl;
        const repo =
          rows.find((r) => r.id === previous.repositoryId) ??
          (configured ? undefined : (rows.find((r) => r.isDefault) ?? rows[0]));
        const binding = readLocalWorkspace(userId, projectId, repo?.id ?? "");
        setWorkspace({
          ...binding,
          repositoryId: repo?.id ?? "",
          originUrl: binding.originUrl || repo?.cloneURL || "",
        });
      })
      .catch((e) => {
        if (alive)
          setError(
            e instanceof Error ? e.message : "Could not load repositories.",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, userId, repositories]);
  return (
    <form
      className="flex max-w-xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        setSaved(false);
        try {
          saveLocalWorkspace(userId, projectId, {
            ...workspace,
            originUrl: workspace.originUrl.trim(),
            path: workspace.path.trim(),
          });
          setSaved(true);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not save settings in this browser.",
          );
        }
      }}
    >
      <p className="text-sm text-ink-2">
        Choose where issue handoffs open on this computer. These settings are
        saved for your account in this browser.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Repository
        <select
          className="rounded-md border border-line bg-surface p-2"
          disabled={loading}
          value={workspace.repositoryId}
          onChange={(e) => {
            const repo = repos.find((r) => r.id === e.target.value),
              binding = readLocalWorkspace(userId, projectId, e.target.value);
            setWorkspace({
              ...binding,
              repositoryId: e.target.value,
              originUrl: binding.originUrl || repo?.cloneURL || "",
            });
            setSaved(false);
          }}
        >
          <option value="">Use a local folder or Git remote</option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName}
              {r.isDefault ? " · Project default" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Git remote URL
        <input
          className="rounded-md border border-line bg-surface p-2"
          maxLength={2048}
          value={workspace.originUrl}
          placeholder="https://github.com/team/project.git"
          onChange={(e) => {
            setWorkspace((w) => ({ ...w, originUrl: e.target.value }));
            setSaved(false);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        My local folder (optional)
        <input
          className="rounded-md border border-line bg-surface p-2"
          maxLength={4096}
          value={workspace.path}
          placeholder="/Users/me/code/project"
          onChange={(e) => {
            setWorkspace((w) => ({ ...w, path: e.target.value }));
            setSaved(false);
          }}
        />
      </label>
      <p className="text-sm text-ink-3">
        Set an absolute local folder to select the exact Codex workspace. If
        the folder is empty, Codex matches the Git remote to an existing
        workspace. After saving, copy the app link again from the handoff.
        T3 Code currently opens the app; select the
        workspace there and paste the summary.
      </p>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-ink-2">
          Local workspace saved.
        </p>
      )}
      <Button className="w-fit" type="submit" disabled={loading}>
        Save local workspace
      </Button>
    </form>
  );
}
