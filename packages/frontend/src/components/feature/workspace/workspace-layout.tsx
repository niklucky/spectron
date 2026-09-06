import type { ReactNode } from "react";
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
      className={`workspace ${collapsed ? "sidebar-collapsed" : ""} ${mobileChat ? "show-chat" : ""}`}
    >
      {children}
    </div>
  );
}
