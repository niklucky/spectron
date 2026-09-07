import { useEffect, useState } from "react";
import type { ProjectField, IssueSettings } from "@spectron/shared";
import { Input, Select } from "../../ui/input";
import { Button } from "../../ui/button";
export type FieldActions = {
  load: () => Promise<IssueSettings>;
  save: (input: {
    id?: string;
    name: string;
    type: ProjectField["type"];
  }) => Promise<void>;
};
export function ProjectFields({
  actions,
  owner,
  onBusyChange,
}: {
  actions: FieldActions;
  owner: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [fields, setFields] = useState<ProjectField[]>([]),
    [name, setName] = useState(""),
    [type, setType] = useState<ProjectField["type"]>("text"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    actions
      .load()
      .then((s) => {
        if (active) setFields(s.fields ?? []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [actions]);
  return (
    <div className="integration-settings">
      <h3>Issue fields</h3>
      <p className="muted">
        Create fields for issues in this project. Values are edited in the
        issue’s details.
      </p>
      <ul className="project-people-list">
        {fields.map((f) => (
          <li key={f.id}>
            <strong>{f.name}</strong>
            <span>{f.type}</span>
          </li>
        ))}
      </ul>
      {owner && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            onBusyChange(true);
            setError("");
            try {
              await actions.save({ name, type });
              setFields((await actions.load()).fields ?? []);
              setName("");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not save field.",
              );
            } finally {
              setBusy(false);
              onBusyChange(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Field name
              <Input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Field type
              <Select
                value={type}
                onChange={(e) =>
                  setType(e.target.value as ProjectField["type"])
                }
              >
                {["text", "date", "number", "user"].map((t) => (
                  <option key={t} value={t}>
                    {t[0]!.toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" disabled={!name.trim()}>
              Create field
            </Button>
          </fieldset>
        </form>
      )}
      {error && (
        <p role="alert" className="project-error">
          {error}
        </p>
      )}
    </div>
  );
}
