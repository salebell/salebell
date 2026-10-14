import type { Metadata } from "next";

export const metadata: Metadata = { title: "App setup" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
