import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { IconButton } from "../button";

export function Dialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
      )
      ?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`dialog ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton icon="close" label="Close dialog" onClick={onClose} />
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
