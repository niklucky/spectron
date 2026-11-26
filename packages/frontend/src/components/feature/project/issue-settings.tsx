import { useEffect, useState } from "react";
import {
  issueTriggers,
  type IssueOptionInput,
  type IssuePriority,
  type IssueState,
  type IssueSettings,
} from "@spectron/shared";
import { Button, IconButton } from "../../ui/button";
import { Input, Select } from "../../ui/input";
import { Pill, type Tone } from "../../ui/pill";
import { StatusDot } from "../../ui/status";
import { SettingsSection } from "../../ui/settings";

const triggerTones: Record<string, Tone> = {
  opened: "neutral", in_progress: "warn", blocked: "bad", cancelled: "neutral", finished: "ok",
};
const triggerLabel = (trigger: string) => {
  const label = trigger.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

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
  const visibleRows = rows.filter((row) => !row.deletedAt);
  return (
    <SettingsSection
      title={kind === "state" ? "Issue states" : kind === "type" ? "Issue types" : kind === "tag" ? "Tags" : "Issue priorities"}
      description={kind === "state"
        ? "Map each state to a workflow type. New issues start in the default state."
        : "Lower positions appear first in issue menus."}
      actions={owner && (
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          disabled={busy || loading || !!draft}
          onClick={() => setDraft({
            projectId, kind, name: "",
            position: Math.max(-1, ...rows.map((r) => r.position)) + 1,
            color: null,
            ...(kind === "state" ? { trigger: "opened", isDefault: false } : {}),
          })}
        >
          Add {kind}
        </Button>
      )}
    >
      {loading ? (
        <p className="text-sm text-ink-2" role="status">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg hairline">
          <table className="w-full border-collapse text-left text-sm" aria-label={kind === "state" ? "Issue states" : kind === "type" ? "Issue types" : kind === "tag" ? "Tags" : "Issue priorities"}>
            <thead className="bg-surface-2 text-xs text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                {kind === "state" && <th scope="col" className="px-4 py-2.5 font-medium">Workflow type</th>}
                <th scope="col" className="w-20 px-4 py-2.5 text-right font-medium">Position</th>
                {owner && <th scope="col" className="w-20 px-3 py-2.5"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className="hairline-t hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {kind === "state" ? <StatusDot trigger={row.trigger ?? "opened"} color={row.color} />
                        : row.color && <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: row.color }} />}
                      <span className="font-medium text-ink break-words">{row.name}</span>
                      {row.isDefault && <Pill tone="accent">Default</Pill>}
                    </div>
                  </td>
                  {kind === "state" && (
                    <td className="px-4 py-3">
                      <Pill tone={triggerTones[row.trigger ?? "opened"] ?? "neutral"}>{triggerLabel(row.trigger ?? "opened")}</Pill>
                    </td>
                  )}
                  <td className="px-4 py-3 text-right text-ink-2 tabular-nums">{row.position}</td>
                  {owner && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <IconButton icon="edit" label={`Edit ${row.name}`} disabled={busy}
                          onClick={() => setDraft({
                            projectId, kind, id: row.id, name: row.name,
                            position: row.position, color: row.color,
                            ...(row.trigger !== undefined ? { trigger: row.trigger, isDefault: row.isDefault } : {}),
                          })}
                        />
                        <IconButton icon="trash" label={`Delete ${row.name}`}
                          title={row.isDefault ? "The default state cannot be deleted" : `Delete ${row.name}`}
                          className="hover:not-disabled:text-bad"
                          disabled={busy || !!row.isDefault}
                          onClick={() => void run(() => actions.remove(kind, row.id))}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!visibleRows.length && <tr><td colSpan={(kind === "state" ? 3 : 2) + (owner ? 1 : 0)} className="px-4 py-6 text-center text-ink-2">No {kind === "priority" ? "priorities" : `${kind}s`} yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {draft && (
        <form
          className="rounded-lg bg-surface-2 p-4 hairline"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => actions.save(draft));
          }}
        >
          <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <h4 className="text-sm font-semibold text-ink">{draft.id ? "Edit" : "Add"} {kind}</h4>
            <label className="flex flex-col gap-1.5 text-sm text-ink-2">
              Name
              <Input
                autoFocus
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm text-ink-2">
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
              <label className="flex flex-col gap-1.5 text-sm text-ink-2">
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
                <label className="flex flex-col gap-1.5 text-sm text-ink-2">
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
                        {triggerLabel(t)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm text-ink-2">
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
            <div className="flex justify-end gap-2 pt-2">
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
        <p className="flex items-center gap-2 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
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
        <p className="text-sm text-ink-2">Only project owners can change these settings.</p>
      )}
    </SettingsSection>
  );
}
