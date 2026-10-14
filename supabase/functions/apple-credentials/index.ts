import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import type { AppleCredentialMetadata } from "../_shared/credentials.ts";
import { createAppleCredentials, RATE_LIMIT } from "./handler.ts";

const db = serviceClientFromEnv(name => Deno.env.get(name));
Deno.serve(createAppleCredentials({
  getUser: db.getUser,
  canManage: async (accountId, userId) => (await db.select<unknown[]>(
    `account_members?account_id=eq.${accountId}&user_id=eq.${userId}&role=in.(owner,admin)&select=user_id`,
  )).length > 0,
  list: (accountId, userId, provider) => db.rpc("list_apple_credentials", { p_account: accountId, p_user: userId, p_provider: provider }),
  save: async value => (await db.rpc<AppleCredentialMetadata[]>("save_apple_credential", {
    p_account: value.accountId, p_user: value.userId, p_provider: value.provider, p_label: value.label,
    p_key_id: value.keyId, p_issuer_id: value.issuerId, p_private_key: value.privateKey, p_id: value.id,
  }))[0] ?? null,
  remove: (id, accountId, userId) => db.rpc("delete_apple_credential", { p_id: id, p_account: accountId, p_user: userId }),
  rateLimit: userId => db.rpc<number>("consume_rate_limit", {
    p_key: `apple-credentials:${userId}`, p_limit: RATE_LIMIT.calls, p_window_seconds: RATE_LIMIT.windowSeconds,
  }),
}));
