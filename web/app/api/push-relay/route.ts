import { createPushRelayProxy } from "@/lib/push-relay-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createPushRelayProxy(name => process.env[name]);
