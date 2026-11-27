import { useState } from "react";
import { Dialog } from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { AvatarField } from "./avatar-field";

export function ProfileDialog({
  name,
  image,
  onSave,
  onClose,
}: {
  name: string;
  image: string | null;
  onSave: (name: string, image?: string | null) => void | Promise<void>;
  onClose: () => void;
}) {
  const [profileName, setProfileName] = useState(name);
  const [avatar, setAvatar] = useState<string | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title="Profile"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!busy && profileName.trim()) {
            setBusy(true);
            setError("");
            try {
              await onSave(profileName.trim(), avatar);
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
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="profile-name">
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
          </div>
          <AvatarField
            name={profileName}
            image={avatar === undefined ? image : avatar}
            onChange={setAvatar}
            disabled={busy}
          />
        </div>
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
