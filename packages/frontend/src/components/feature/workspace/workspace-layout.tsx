import type { ReactNode } from "react";
import { cn } from "../../ui/cn";

/**
 * Three columns: sidebar, issue list, conversation. The issue drawer lives
 * inside the conversation column, so the grid never changes shape for it.
 */
export function WorkspaceLayout({
  collapsed,
  mobileChat,
  children,
}: {
  collapsed: boolean;
  mobileChat: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-collapsed={collapsed || undefined}
      data-mobile-chat={mobileChat || undefined}
      className={cn(
        "workspace group/ws grid h-dvh bg-bg text-ink [&>*]:min-h-0 [&>*]:overflow-hidden",
        collapsed
          ? "grid-cols-[64px_320px_minmax(0,1fr)] max-[1180px]:grid-cols-[64px_300px_minmax(0,1fr)]"
          : "grid-cols-[236px_340px_minmax(0,1fr)] max-[1380px]:grid-cols-[224px_316px_minmax(0,1fr)] max-[1180px]:grid-cols-[64px_300px_minmax(0,1fr)]",
        "max-[700px]:grid-cols-[56px_minmax(0,1fr)]",
        mobileChat ? "max-[700px]:[&>.task-panel]:hidden" : "max-[700px]:[&>.chat-column]:hidden",
      )}
    >
      {children}
    </div>
  );
}
