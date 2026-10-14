import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { createFxRefresh } from "./handler.ts";

const db = serviceClientFromEnv((name) => Deno.env.get(name));

Deno.serve(createFxRefresh({
  lastUpdated: async () =>
    (await db.select<Array<{ updated_at: string }>>("fx_rates?select=updated_at&order=updated_at.desc&limit=1"))[0]?.updated_at ?? null,
  upsert: (rates) => db.rpc<number>("upsert_fx_rates", { p_rates: rates }),
}));
