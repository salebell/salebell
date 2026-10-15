export type Provider = "vercel" | "supabase";
export type PendingOAuth = { provider: Provider; hash: string; expires: number; verifier?: string };
export type Phase = "clone" | "connect_supabase" | "validate" | "migrations" | "settings" | "functions" | "auth" | "deploy" | "verify" | "owner" | "complete" | "canceled";
export type ProviderTokens = { access: string; refresh?: string; expires?: number };
export type Target = { projectId: string; projectName: string; teamId?: string; supabaseRef: string; supabaseName: string; origin: string; publicKey: string; configurationId: string; revision?: string };
export type InstallJob = {
  id: string; version: number; phase: Phase; createdAt: number; expiresAt: number;
  pending?: PendingOAuth; vercel?: ProviderTokens & { configurationId: string; teamId?: string };
  supabase?: ProviderTokens; target?: Target; projectHint?: string;
  cursor: number; deploymentId?: string; error?: string; retryAt?: number;
  ownerEmail?: string; ownerId?: string;
};
export type MigrationAsset = { name: string; sha256: string; sql: string };
export type FunctionAsset = { slug: string; verifyJwt: boolean; files: { name: string; content: string }[] };
export type Release = { id: string; migrations: MigrationAsset[]; functions: FunctionAsset[] };
