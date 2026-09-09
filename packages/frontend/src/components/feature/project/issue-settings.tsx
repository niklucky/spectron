import { useEffect, useState } from "react";
import {
  issueTriggers,
  type IssueOptionInput,
  type IssuePriority,
  type IssueState,
  type IssueSettings,
} from "@spectron/shared";
import { Button } from "../../ui/button";
import { Input, Select } from "../../ui/input";
export type IssueSettingsActions = {
  load: () => Promise<IssueSettings>;
  save: (input: IssueOptionInput) => Promise<void>;
  remove: (kind: "state" | "priority" | "type" | "tag", id: string) => Promise<void>;
};
export function ProjectIssueSettings({
  projectId,
  owner,
  kind,
  actions,
  onBusyChange,
}: {
  projectId: string;
  owner: boolean;
  kind: "state" | "priority" | "type" | "tag";
  actions: IssueSettingsActions;
  onBusyChange: (busy: boolean) => void;
}) {
  const [settings, setSettings] = useState<IssueSettings>({
    states: [],
    priorities: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<IssueOptionInput | null>(null);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    actions
      .load()
      .then((result) => {
        if (active) {
          setSettings(result);
          setError("");
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not load settings.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actions, reload]);
  const rows: (IssuePriority &
    Partial<Pick<IssueState, "trigger" | "isDefault">>)[] =
    kind === "state" ? settings.states : kind === "type" ? settings.issueTypes ?? [] : kind === "tag" ? settings.tags ?? [] : settings.priorities;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setDraft(null);
      setReload((n) => n + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>{kind === "state" ? "Issue states" : kind === "type" ? "Issue types" : kind === "tag" ? "Tags" : "Issue priorities"}</h3>
      <p className="muted">
        {kind === "state"
          ? "Choose project labels and their canonical states. The default must map to Opened. Automations will come later."
          : "Manage this project’s dictionary. Lower positions appear first."}
      </p>
      {loading ? (
        <p role="status">Loading…</p>
      ) : (
        <ul className="issue-option-list">
          {rows
            .filter((r) => !r.deletedAt)
            .map((row) => (
              <li key={row.id}>
                <span>
                  {row.color && (
                    <i
                      className="issue-option-color"
                      style={{ background: row.color }}
                      aria-hidden="true"
                    />
                  )}
                  {row.name}
                  <small>
                    {row.trigger !== undefined
                      ? `${row.trigger.replaceAll("_", " ")}${row.isDefault ? " · Default" : ""} · `
                      : ""}
                    Position {row.position}
                  </small>
                </span>
                {owner && (
                  <>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        setDraft({
                          projectId,
                          kind,
                          id: row.id,
                          name: row.name,
                          position: row.position,
                          color: row.color,
                          ...(row.trigger !== undefined
                            ? { trigger: row.trigger, isDefault: row.isDefault }
                            : {}),
                        })
                      }
                      aria-label={`Edit ${row.name}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy || !!row.isDefault}
                      onClick={() =>
                        void run(() => actions.remove(kind, row.id))
                      }
                      aria-label={`Delete ${row.name}`}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </li>
            ))}
        </ul>
      )}
      {owner && !draft && (
        <Button
          disabled={busy || loading}
          onClick={() =>
            setDraft({
              projectId,
              kind,
              name: "",
              position: Math.max(-1, ...rows.map((r) => r.position)) + 1,
              color: null,
              ...(kind === "state"
                ? { trigger: "opened", isDefault: false }
                : {}),
            })
          }
        >
          Add {kind}
        </Button>
      )}
      {draft && (
        <form
          className="issue-option-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => actions.save(draft));
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Name
              <Input
                autoFocus
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <div className="issue-field-grid">
              <label>
                Position
                <Input
                  type="number"
                  min={0}
                  max={10000}
                  required
                  value={draft.position}
                  onChange={(e) =>
                    setDraft({ ...draft, position: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Color (optional)
                <Input
                  placeholder="#5588aa"
                  pattern="#[0-9a-fA-F]{6}"
                  value={draft.color ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, color: e.target.value || null })
                  }
                />
              </label>
            </div>
            {kind === "state" && (
              <>
                <label>
                  Canonical state
                  <Select
                    value={draft.trigger}
                    disabled={!!draft.id}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        trigger: e.target.value as typeof draft.trigger,
                        isDefault: false,
                      })
                    }
                  >
                    {issueTriggers.map((t) => (
                      <option key={t} value={t}>
                        {t.replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  <span>
                    <input
                      type="checkbox"
                      checked={draft.isDefault ?? false}
                      disabled={
                        draft.trigger !== "opened" ||
                        (!!draft.id &&
                          settings.states.some(
                            (s) => s.id === draft.id && s.isDefault,
                          ))
                      }
                      onChange={(e) =>
                        setDraft({ ...draft, isDefault: e.target.checked })
                      }
                    />{" "}
                    Default for new issues
                  </span>
                </label>
              </>
            )}
            <div className="dialog-footer">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!draft.name.trim() || busy}>
                Save {kind}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="project-error" role="alert">
          {error}{" "}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setReload((n) => n + 1)}
          >
            Reload
          </Button>
        </p>
      )}
      {!owner && (
        <p className="muted">Only project owners can change these settings.</p>
      )}
    </>
  );
}
