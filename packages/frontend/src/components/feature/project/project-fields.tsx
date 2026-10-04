import { useEffect, useState } from "react";
import type { ProjectField, IssueSettings } from "@spectron/shared";
import { Field, Input, Select } from "../../ui/input";
import { Button } from "../../ui/button";
import { Pill } from "../../ui/pill";
import { Feedback, SettingsSection } from "../../ui/settings";
export type FieldActions = {
  load: () => Promise<IssueSettings>;
  save: (input: {
    id?: string;
    name: string;
    type: ProjectField["type"];
  }) => Promise<void>;
};
const typeLabel = (type: string) => type[0]!.toUpperCase() + type.slice(1);
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
    <>
      <SettingsSection title="Issue fields" description="Values are edited in the issue’s details.">
        {fields.length ? (
          <ul className="overflow-hidden rounded-xl hairline">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 text-sm [&+&]:hairline-t">
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{f.name}</span>
                <Pill>{typeLabel(f.type)}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No custom fields yet.</p>
        )}
      </SettingsSection>
      {owner && (
        <SettingsSection title="New field">
          <form
            className="flex max-w-[520px] flex-col gap-3"
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
                setError(e instanceof Error ? e.message : "Could not save field.");
              } finally {
                setBusy(false);
                onBusyChange(false);
              }
            }}
          >
            <fieldset disabled={busy} className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-[minmax(0,1fr)_160px]">
              <Field label="Field name">
                <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Customer" />
              </Field>
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value as ProjectField["type"])}>
                  {["text", "date", "number", "user"].map((t) => (
                    <option key={t} value={t}>{typeLabel(t)}</option>
                  ))}
                </Select>
              </Field>
            </fieldset>
            <div>
              <Button type="submit" variant="primary" disabled={busy || !name.trim()}>Create field</Button>
            </div>
          </form>
          <Feedback error={error} />
        </SettingsSection>
      )}
    </>
  );
}
