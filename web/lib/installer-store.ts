import { randomUUID } from "node:crypto";
import type { InstallerConfig } from "./installer-config.ts";
import type { InstallJob } from "./installer-types.ts";
import { seal, unseal } from "./installer-security.ts";
import { apiRequest } from "./installer-providers.ts";

type RecordRow = { id: string; version: number; document: Omit<InstallJob, "pending" | "vercel" | "supabase">; credentials: string | null; lease?: string };
export class InstallerStore {
  config: Pick<InstallerConfig, "controlUrl" | "controlKey" | "encryptionKey">; fetcher: typeof fetch;
  constructor(config: InstallerStore["config"], fetcher: typeof fetch = fetch) { this.config = config; this.fetcher = fetcher; }
  rpc<T>(name: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { apikey: this.config.controlKey, "content-type": "application/json" };
    if (this.config.controlKey.startsWith("eyJ")) headers.authorization = `Bearer ${this.config.controlKey}`;
    return apiRequest<T>(`${this.config.controlUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) }, this.fetcher);
  }
  private encode(job: InstallJob) {
    const { pending, vercel, supabase, ...document } = job;
    const credentials = pending || vercel || supabase ? seal({ pending, vercel, supabase }, this.config.encryptionKey, job.id) : null;
    return { document, credentials };
  }
  private decode(row: RecordRow | null, code: string): InstallJob {
    if (!row) throw new Error(code);
    const credentials = row.credentials ? unseal<Pick<InstallJob, "pending" | "vercel" | "supabase">>(row.credentials, this.config.encryptionKey, row.id) : {};
    return { ...row.document, ...credentials, id: row.id, version: row.version };
  }
  async create(job: InstallJob, hash: string) {
    const { document, credentials } = this.encode(job);
    await this.rpc("installer_create", { p_id: job.id, p_hash: hash, p_document: document, p_credentials: credentials });
  }
  async read(id: string, hash: string) { return this.decode(await this.rpc<RecordRow | null>("installer_read", { p_id: id, p_hash: hash }), "session_expired"); }
  async acquire(id: string, hash: string) {
    const lease = randomUUID();
    const row = await this.rpc<RecordRow | null>("installer_acquire", { p_id: id, p_hash: hash, p_lease: lease });
    return { job: this.decode(row, "busy_or_expired"), lease };
  }
  async save(job: InstallJob, hash: string, lease: string, bindRef?: string, renew = false) {
    const { document, credentials } = this.encode(job);
    const row = await this.rpc<RecordRow | null>("installer_save", { p_id: job.id, p_hash: hash, p_version: job.version, p_lease: lease, p_document: document, p_credentials: credentials, p_project_ref: bindRef ?? null, p_renew: renew });
    return this.decode(row, "busy_or_expired");
  }
  rate(key: string, limit: number, window = 60) { return this.rpc<number>("installer_rate_limit", { p_key: key, p_limit: limit, p_window: window }); }
  cleanup() { return this.rpc<number>("installer_cleanup", {}); }
}
