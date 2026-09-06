import { useState } from "react";
import type { CreateProjectInput } from "@spectron/shared";
import { Dialog } from "../../ui/dialog";
import { ProjectForm } from "./project-form";
export function CreateProjectDialog({
  first,
  onCreate,
  onClose,
  onDiscoverLogo,
}: {
  first: boolean;
  onCreate: (input: CreateProjectInput) => Promise<void>;
  onClose: () => void;
  onDiscoverLogo: (url: string) => Promise<{ logo: string | null }>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={first ? "Create your first project" : "New project"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {first && (
        <p className="project-intro">
          Give your work a home. You can also skip this and join a project when
          you’re invited.
        </p>
      )}
      <ProjectForm
        onSubmit={onCreate}
        onCancel={onClose}
        onDiscoverLogo={onDiscoverLogo}
        onBusyChange={setBusy}
        cancelLabel={first ? "Skip for now" : "Cancel"}
      />
    </Dialog>
  );
}
