import { useState } from "react";
import { Dialog } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
export function ProfileDialog({
  name,
  onSave,
  onClose,
}: {
  name: string;
  onSave: (name: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [profileName, setProfileName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title="Profile" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (profileName.trim()) {
            setBusy(true);
            setError("");
            try {
              await onSave(profileName.trim());
              onClose();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not save your profile.",
              );
            } finally {
              setBusy(false);
            }
          }
        }}
      >
        <label className="field-label" htmlFor="profile-name">
          Display name
        </label>
        <Input
          id="profile-name"
          value={profileName}
          onChange={(event) => setProfileName(event.target.value)}
          required
          maxLength={40}
          disabled={busy}
        />
        <div className="dialog-footer">
          <span role="alert">{error}</span>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
