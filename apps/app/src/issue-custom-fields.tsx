import { useEffect, useState } from "react";
import type {
  IssueSummary,
  IssueFields,
  ProjectMemberSummary,
} from "@spectron/shared";
import { trpc } from "./lib/trpc";
type Field = Awaited<ReturnType<typeof trpc.projectFields.list.query>>[number];
export function IssueCustomFields({
  issue,
  save,
}: {
  issue: IssueSummary;
  save: (issue: IssueSummary, fields: Partial<IssueFields>) => Promise<void>;
}) {
  const [fields, setFields] = useState<Field[]>([]),
    [users, setUsers] = useState<ProjectMemberSummary[]>([]);
  const [values, setValues] = useState(issue.customFields ?? {}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setValues(issue.customFields ?? {});
  }, [issue.updatedAt]);
  useEffect(() => {
    let active = true;
    Promise.all([
      trpc.projectFields.list.query({ projectId: issue.projectId }),
      trpc.projects.members.query({ id: issue.projectId }),
    ])
      .then(([fields, users]) => {
        if (active) {
          setFields(fields);
          setUsers(users);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [issue.projectId]);
  return (
    <section className="tracker-settings">
      {issue.externalKey && (
        <p>
          Yandex Tracker:{" "}
          <a
            href={`https://tracker.yandex.ru/${encodeURIComponent(issue.externalKey)}`}
            target="_blank"
            rel="noreferrer"
          >
            {issue.externalKey}
          </a>
        </p>
      )}
      {!!fields.length && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            void save(issue, { customFields: values })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <fieldset disabled={busy || !!issue.deletedAt}>
            <legend>Project fields</legend>
            {fields.map((field) => (
              <label key={field.id}>
                {field.name}
                {field.type === "user" ? (
                  <select
                    value={values[field.id] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [field.id]: e.target.value || null,
                      }))
                    }
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === "text" ? "text" : field.type}
                    step={field.type === "number" ? "any" : undefined}
                    value={values[field.id] ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setValues((v) => ({
                        ...v,
                        [field.id]:
                          value === ""
                            ? null
                            : field.type === "number"
                              ? Number(value)
                              : value,
                      }));
                    }}
                  />
                )}
              </label>
            ))}
            <button type="submit">Save fields</button>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="project-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
