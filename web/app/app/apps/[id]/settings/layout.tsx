import type { Metadata } from "next";

export const metadata: Metadata = { title: "App settings" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
