import type { InstallJob } from "./installer-types.ts";
import { apiRequest } from "./installer-providers.ts";

export function ownerInput(email: unknown, password: unknown) {
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== "string" || password.length < 12 || password.length > 128) throw new Error("invalid_owner_credentials");
  return { email: email.trim().toLowerCase(), password };
}
export async function finishOwner(job: InstallJob, email: string, password: string, adminKey: string, fetcher: typeof fetch = fetch): Promise<InstallJob> {
  const input = ownerInput(email, password);
  if (!job.target || job.phase !== "owner" || job.ownerEmail !== input.email) throw new Error("owner_conflict");
  const origin = `https://${job.target.supabaseRef}.supabase.co`;
  const headers: Record<string, string> = { apikey: adminKey, "content-type": "application/json" };
  if (adminKey.startsWith("eyJ")) headers.authorization = `Bearer ${adminKey}`;
  const { users } = await apiRequest<{ users: { id: string; email: string }[] }>(`${origin}/auth/v1/admin/users?page=1&per_page=2`, { headers }, fetcher);
  if (users.length > 1 || (users.length === 1 && users[0].email.toLowerCase() !== input.email)) throw new Error("owner_conflict");
  if (!users.length) await apiRequest(`${origin}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ email: input.email, password: input.password, email_confirm: true }) }, fetcher);
  let session: { access_token: string; user: { id: string; email: string } };
  try { session = await apiRequest(`${origin}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: job.target.publicKey, "content-type": "application/json" }, body: JSON.stringify(input) }, fetcher); }
  catch { throw new Error("owner_signin_failed"); }
  if (!session.access_token) throw new Error("owner_signin_failed");
  const userHeaders = { apikey: job.target.publicKey, authorization: `Bearer ${session.access_token}`, "content-type": "application/json" };
  try {
    if (session.user?.email.toLowerCase() !== input.email || (users.length && session.user.id !== users[0].id)) throw new Error("owner_conflict");
    const accounts = await apiRequest<{ id: string }[]>(`${origin}/rest/v1/accounts?select=id&limit=1`, { headers: userHeaders }, fetcher);
    if (!accounts.length) throw new Error("owner_workspace_missing");
    const protectedCheck = await fetcher(`${origin}/functions/v1/test-alert`, { method: "POST", headers: userHeaders, body: "{}", redirect: "error", signal: AbortSignal.timeout(15_000) });
    await protectedCheck.body?.cancel();
    if (protectedCheck.status !== 400) throw new Error("protected_function_check_failed");
  } finally {
    await apiRequest(`${origin}/auth/v1/logout?scope=local`, { method: "POST", headers: userHeaders }, fetcher);
  }
  return { ...job, phase: "complete", ownerId: session.user.id, pending: undefined, supabase: undefined, error: undefined };
}
