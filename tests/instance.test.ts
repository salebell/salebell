import assert from "node:assert/strict";
import { test } from "node:test";
import { loadInstanceSettings } from "../supabase/functions/_shared/instance.ts";
import { createServiceClient } from "../supabase/functions/_shared/supabase.ts";

test("server billing reads deployment changes from the database rather than retaining an environment flag", async () => {
  const replies = [
    { deployment_mode: "cloud", billing_enabled: true },
    { deployment_mode: "self_hosted", billing_enabled: false },
  ];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "http://gateway:8000/rest/v1/rpc/instance_settings");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, "{}");
    return Response.json(replies.shift());
  };
  const db = createServiceClient("http://gateway:8000", "server-only-test-key", fetcher);
  assert.deepEqual(await loadInstanceSettings(db), { deployment_mode: "cloud", billing_enabled: true });
  assert.deepEqual(await loadInstanceSettings(db), { deployment_mode: "self_hosted", billing_enabled: false });
});

test("server billing rejects missing, inconsistent and malformed instance metadata", async () => {
  for (const reply of [null, {}, { deployment_mode: "cloud" },
    { deployment_mode: "self_hosted", billing_enabled: true },
    { deployment_mode: "cloud", billing_enabled: false },
    { deployment_mode: "unknown", billing_enabled: true }]) {
    const db = createServiceClient("http://gateway:8000", "server-only-test-key", async () => Response.json(reply));
    await assert.rejects(loadInstanceSettings(db), /invalid_instance_settings/);
  }
  const down = createServiceClient("http://gateway:8000", "server-only-test-key", async () => Response.json({}, { status: 503 }));
  await assert.rejects(loadInstanceSettings(down), /HTTP 503/);
});
