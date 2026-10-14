import type { Metadata } from "next";
import { AppShell } from "@/components/app/shell";
import { WorkspaceProvider } from "@/components/app/workspace";

export const metadata: Metadata = { title: { default: "Apps", template: "%s · Salebell" }, robots: { index: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
