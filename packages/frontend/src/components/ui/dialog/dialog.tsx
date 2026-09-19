import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { IconButton } from "../button";
import { cn } from "../cn";

/** Modal dialog on the native <dialog> element. */
export function Dialog({
  title,
  children,
  onClose,
  className = "",
  size = "md",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string | undefined;
  size?: "sm" | "md" | "lg" | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled]), select:not([disabled])")
      ?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn(
        "m-auto max-h-[calc(100dvh-48px)] w-[calc(100vw-32px)] overflow-hidden rounded-2xl border-0 bg-surface p-0 text-ink shadow-pop hairline backdrop:bg-black/35 backdrop:backdrop-blur-[2px] open:flex open:flex-col",
        size === "sm" && "max-w-md",
        size === "md" && "max-w-xl",
        size === "lg" && "max-w-3xl",
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 py-3 pr-3 pl-5 hairline-b">
        <h2 id={titleId} className="truncate text-base font-semibold">
          {title}
        </h2>
        <IconButton icon="close" label="Close dialog" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-base">{children}</div>
    </dialog>
  );
}

/** Right-aligned action row at the bottom of a dialog body. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap justify-end gap-1.5">{children}</div>;
}
