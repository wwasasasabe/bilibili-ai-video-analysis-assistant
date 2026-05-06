import type { ReactNode } from "react";

export function SidebarShell({ children }: { children: ReactNode }) {
  return <main className="app-shell">{children}</main>;
}
