import { useEffect, useState } from "react";
import {
  localAppLaunch,
  localAppName,
  type LocalHandoffView,
  type LocalHandoffDraft,
  type LocalHandoffActions,
} from "@spectron/shared";
import { readLocalWorkspace } from "../../../lib/local-workspace";
import { isT3Preview } from "../../../lib/local-app-launch";
import { Button } from "../../ui/button";
import { MessageRow } from "../../ui/chat";
import { formatDateTime } from "../../../lib/date-format";

export function LocalHandoffCard({
  handoff,
  actions,
  currentUserId,
  changed,
}: {
  handoff: LocalHandoffView;
  actions: LocalHandoffActions;
  currentUserId: string;
  changed: () => void;
}) {
  const [draft, setDraft] = useState<LocalHandoffDraft | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState(false),
    [showAppLink, setShowAppLink] = useState(false),
    [revision, setRevision] = useState(0);
  const embeddedPreview = isT3Preview(navigator.userAgent);
  const own = currentUserId === handoff.ownerId;
  const scope = {
    projectId: handoff.projectId,
    issueId: handoff.issueId,
    id: handoff.id,
  };
  useEffect(() => {
    if (!own) return;
    let alive = true;
    setDraft(null);
    setError("");
    void actions.draft(scope).then(
      (value) => {
        if (alive) setDraft(value);
      },
      (cause) => {
        if (alive)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not prepare the summary.",
          );
      },
    );
    return () => {
      alive = false;
    };
  }, [
    actions,
    handoff.id,
    handoff.projectId,
    handoff.issueId,
    handoff.filesRevoked,
    own,
    revision,
  ]);
  useEffect(() => {
    const refresh = () => setRevision((v) => v + 1);
    window.addEventListener("spectron:local-workspace", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("spectron:local-workspace", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const workspace = readLocalWorkspace(
    currentUserId,
    handoff.projectId,
    draft?.repositoryId,
  );
  const launch = draft
    ? localAppLaunch(handoff.application, draft.summary, {
        path: workspace.path,
        originUrl: workspace.originUrl || draft.originUrl || "",
      })
    : null;
  const workspaceRemote = workspace.originUrl || draft?.originUrl;
  async function copy() {
    if (!draft) return;
    setError("");
    try {
      await navigator.clipboard.writeText(draft.summary);
      setNotice("Summary copied.");
    } catch {
      setPreview(true);
      setError(
        "Clipboard access is unavailable. Select and copy the summary below.",
      );
    }
  }
  async function copyAppLink() {
    if (!launch) return;
    setError("");
    try {
      await navigator.clipboard.writeText(launch.url);
      setNotice(
        "App link copied. Paste it into Chrome or Safari's address bar to open the app.",
      );
    } catch {
      setShowAppLink(true);
      setError(
        "Clipboard access is unavailable. Select and copy the app link below.",
      );
    }
  }
  return (
    <MessageRow
      author={{ name: handoff.agentName, kind: "agent" }}
      own={false}
      time={new Date(handoff.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
      timeTitle={formatDateTime(handoff.createdAt)}
    >
      <div className="my-1 w-full max-w-[66ch] rounded-lg border border-line-soft bg-surface-2 p-3">
        <p className="font-semibold">Passing work to {handoff.agentName}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2">
          {handoff.message}
        </p>
        <p className="mt-2 text-xs text-ink-3">
          {handoff.ownerName} · {localAppName(handoff.application)} ·{" "}
          {handoff.launchRequestedAt ? "Launch requested" : "Ready to open"}
        </p>
        {own && (
          <>
            {draft && handoff.application === "codex" && (
              <p className="mt-2 break-words text-sm text-ink-2">
                {workspace.path
                  ? `Workspace: ${workspace.path}`
                  : workspaceRemote
                    ? `Workspace remote: ${workspaceRemote}`
                    : "No workspace selected. Set My local folder in Project settings → Local apps to choose where Codex opens."}
              </p>
            )}
            {embeddedPreview && (
              <p className="mt-2 text-sm text-ink-2" role="status">
                T3 Code's preview cannot open desktop apps. Copy the app link
                and paste it into Chrome or Safari's address bar.
              </p>
            )}
            <p className="mt-2 text-sm text-ink-3">
              {handoff.application === "t3code"
                ? "Copy the summary, open T3 Code, and paste it into a new chat in your workspace."
                : launch && !launch.prefilled
                  ? "This summary is too long for an app link. Copy it and paste it into the new Codex chat."
                  : "The app link opens a new Codex chat with a draft ready for you to send."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {launch && !embeddedPreview && (
                <a
                  className="inline-flex h-7 items-center rounded-md bg-ink px-2.5 text-sm font-medium text-surface"
                  href={launch.url}
                  onClick={() => {
                    setNotice(
                      "Launch requested. If the app stays closed, try this button again.",
                    );
                    if (!launch.prefilled) void copy();
                    void actions
                      .markLaunch(scope)
                      .then(changed)
                      .catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Could not record launch request.",
                        ),
                      );
                  }}
                >
                  Open {localAppName(handoff.application)}
                </a>
              )}
              {launch && embeddedPreview && (
                <Button onClick={() => void copyAppLink()}>
                  Copy app link
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={!draft}
                onClick={() => void copy()}
              >
                Copy summary
              </Button>
              <Button
                variant="ghost"
                disabled={!draft}
                onClick={() => setPreview((v) => !v)}
              >
                {preview ? "Hide summary" : "View summary"}
              </Button>
              {!handoff.filesRevoked && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    void actions
                      .revokeFiles(scope)
                      .then(() => {
                        setNotice("Attachment download access revoked.");
                        changed();
                      })
                      .catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Could not revoke download access.",
                        ),
                      );
                  }}
                >
                  Revoke file links
                </Button>
              )}
            </div>
            {!draft && !error && (
              <p className="mt-2 text-sm text-ink-3" role="status">
                Preparing summary…
              </p>
            )}
            {error && (
              <p className="mt-2 text-sm text-bad" role="alert">
                {error}{" "}
                {!draft && (
                  <Button
                    variant="ghost"
                    onClick={() => setRevision((v) => v + 1)}
                  >
                    Retry
                  </Button>
                )}
              </p>
            )}
            {notice && (
              <p className="mt-2 text-sm text-ink-2" role="status">
                {notice}
              </p>
            )}
            {preview && draft && (
              <textarea
                aria-label="Handoff summary"
                className="mono mt-3 w-full rounded-md border border-line bg-surface p-2 text-sm"
                rows={12}
                readOnly
                value={draft.summary}
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
            {showAppLink && launch && (
              <textarea
                aria-label="App launch link"
                className="mono mt-3 w-full rounded-md border border-line bg-surface p-2 text-sm"
                rows={3}
                readOnly
                value={launch.url}
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
          </>
        )}
      </div>
    </MessageRow>
  );
}
