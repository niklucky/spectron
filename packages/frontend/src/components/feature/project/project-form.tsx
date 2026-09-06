import { useEffect, useState } from "react";
import { normalizeProjectURL, type CreateProjectInput } from "@spectron/shared";
import { ProjectLogoField } from "./project-logo-field";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
export function ProjectForm({
  initialValues,
  onSubmit,
  onCancel,
  onDiscoverLogo,
  onBusyChange,
  readOnly = false,
  submitLabel = "Create project",
  cancelLabel = "Cancel",
}: {
  initialValues?: CreateProjectInput;
  onSubmit: (input: CreateProjectInput) => Promise<void>;
  onCancel: () => void;
  onDiscoverLogo: (url: string) => Promise<{ logo: string | null }>;
  onBusyChange: (busy: boolean) => void;
  readOnly?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
}) {
  const [name, setName] = useState(initialValues?.name || "");
  const [key, setKey] = useState(initialValues?.key || "");
  const [keyEdited, setKeyEdited] = useState(!!initialValues);
  const [url, setURL] = useState(initialValues?.url || "");
  const [logo, setLogo] = useState<string | null>(initialValues?.logo || null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  return (
    <form
      className="project-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (readOnly || busy || logoBusy || !name.trim()) return;
        setBusy(true);
        setError("");
        try {
          await onSubmit({
            name: name.trim(),
            key: key.trim().toUpperCase(),
            url: normalizeProjectURL(url),
            logo,
          });
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn’t save the project. Please try again.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || readOnly}>
        <label htmlFor="project-name">Project name</label>
        <Input
          id="project-name"
          autoFocus
          required
          maxLength={80}
          placeholder="e.g. Spectron"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!keyEdited)
              setKey(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .replace(/^[0-9]+/, "")
                  .slice(0, 3),
              );
          }}
        />
        <div className="project-form-row">
          <label>
            Issue prefix
            <Input
              aria-label="Issue prefix"
              required
              minLength={2}
              maxLength={10}
              pattern="[A-Z][A-Z0-9]{1,9}"
              title="2–10 letters or numbers, starting with a letter"
              value={key}
              onChange={(event) => {
                setKeyEdited(true);
                setKey(event.target.value.toUpperCase());
              }}
            />
          </label>
        </div>
        <label className="project-url-label" htmlFor="project-url">
          Website URL <span className="project-optional">Optional</span>
        </label>
        <Input
          id="project-url"
          inputMode="url"
          autoComplete="url"
          maxLength={2048}
          placeholder="https://example.com"
          value={url}
          onChange={(event) => setURL(event.target.value)}
          onBlur={() => {
            try {
              const normalized = normalizeProjectURL(url);
              if (normalized) setURL(normalized);
            } catch {
              /* Validate on submit. */
            }
          }}
        />
        <ProjectLogoField
          preserveInitial={!!initialValues}
          initial={name.trim().charAt(0).toUpperCase() || "?"}
          url={url}
          logo={logo}
          onChange={setLogo}
          onBusyChange={setLogoBusy}
          onDiscover={onDiscoverLogo}
        />
        {error && (
          <p className="project-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            disabled={busy || logoBusy || !name.trim() || readOnly}
          >
            {busy ? "Saving…" : submitLabel}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
