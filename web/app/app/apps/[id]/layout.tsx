import type { Metadata } from "next";
import { AppDetail } from "./app-detail";

export const metadata: Metadata = { title: "App overview" };

export default function AppDetailLayout({ children }: { children: React.ReactNode }) {
  return <AppDetail>{children}</AppDetail>;
}
