"use client";

import { useParams } from "next/navigation";
import { useLoadedWorkspace } from "./workspace";

export function useCurrentApp() {
  const { id } = useParams<{ id: string }>();
  const workspace = useLoadedWorkspace();
  const app = workspace.ws.apps.find((a) => a.id === id) ?? null;
  return { app, paused: app ? workspace.pausedAppIds.has(app.id) : false, ...workspace };
}
