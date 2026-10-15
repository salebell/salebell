export type Provider = "supabase";
export type PendingOAuth = { provider: Provider; hash: string; expires: number; verifier?: string };
export type Phase = "clone" | "connect_supabase" | "validate" | "migrations" | "settings" | "functions" | "auth" | "verify" | "owner" | "complete" | "canceled";
export type ProviderTokens = { access: string; refresh?: string; expires?: number };
export type Target = { projectName: string; supabaseRef: string; supabaseName: string; origin: string; publicKey: string };
export type InstallJob = {
  id: string; version: number; phase: Phase; createdAt: number; expiresAt: number;
  pending?: PendingOAuth;
  supabase?: ProviderTokens; target?: Target; siteHint?: string;
  cursor: number; error?: string; retryAt?: number;
  ownerEmail?: string; ownerId?: string;
};
export type MigrationAsset = { name: string; sha256: string; sql: string };
export type FunctionAsset = { slug: string; verifyJwt: boolean; files: { name: string; content: string }[] };
export type Release = { id: string; migrations: MigrationAsset[]; functions: FunctionAsset[] };
