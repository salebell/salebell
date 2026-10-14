"use client";

import Link from "next/link";
import { AddAppOptions } from "@/components/app/add-app-options";
import { Card } from "@/components/ui";

export default function NewAppPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/app" className="text-sm text-muted hover:text-fg">
        ← Apps
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-[1.75rem]">Add an app</h1>
      <p className="mt-1.5 text-muted">Connect your store. Pick your app. Hear your next sale.</p>
      <Card className="mt-6 p-4 sm:p-6">
        <AddAppOptions />
      </Card>
    </div>
  );
}
