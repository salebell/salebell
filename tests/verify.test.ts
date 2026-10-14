// Run: node --experimental-strip-types --test tests/   (Node 22+, no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { AppleJwsVerificationError, loadTrustedRoots, verifyAppleJws } from "../supabase/functions/_shared/core/apple_jws.ts";
import { APPLE_ROOT_CA_G3 } from "../supabase/functions/_shared/core/apple_roots.ts";

const PKI = new URL("./fixtures", import.meta.url).pathname;
const b64 = (n: string) => readFileSync(`${PKI}/${n}.b64`, "utf8").trim();
const apple = JSON.parse(readFileSync(`${PKI}/apple_fixtures.json`, "utf8"));
const leafKey = createPrivateKey(readFileSync(`${PKI}/leaf-test-key.pem`));
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function jws(payload: object, x5c: string[] = [b64("leaf"), b64("inter"), b64("root")], key = leafKey) {
  const h = enc({ alg: "ES256", x5c });
  const p = enc(payload);
  const sig = sign("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${sig.toString("base64url")}`;
}

const roots = loadTrustedRoots([b64("root")]);
const now = Date.now();

async function rejects(p: Promise<unknown>, reason: string) {
  await assert.rejects(p, (e: unknown) => e instanceof AppleJwsVerificationError && e.reason === reason);
}

test("valid synthetic chain verifies", async () => {
  const out = await verifyAppleJws<{ a: number; signedDate: number }>(jws({ a: 1, signedDate: now }), roots);
  assert.equal(out.a, 1);
});

test("rejects tampered payload", async () => {
  const [h, , s] = jws({ a: 1, signedDate: now }).split(".");
  await rejects(verifyAppleJws(`${h}.${enc({ a: 2, signedDate: now })}.${s}`, roots), "invalid_jws_signature");
});

test("rejects intermediate signed by a look-alike root", async () => {
  await rejects(verifyAppleJws(jws({ signedDate: now }, [b64("leaf"), b64("inter_evil"), b64("root")]), roots), "untrusted_chain");
});

test("ignores supplied x5c root (attacker root in header does not help)", async () => {
  await rejects(verifyAppleJws(jws({ signedDate: now }, [b64("leaf"), b64("inter_evil"), b64("evil")]), roots), "untrusted_chain");
});

test("rejects intermediate without CA flag", async () => {
  await rejects(verifyAppleJws(jws({ signedDate: now }, [b64("leaf"), b64("inter_noca")]), roots), "untrusted_chain");
});

test("rejects missing Apple OIDs", async () => {
  await rejects(verifyAppleJws(jws({ signedDate: now }, [b64("leaf_nooid"), b64("inter")]), roots), "invalid_apple_oid");
  await rejects(verifyAppleJws(jws({ signedDate: now }, [b64("leaf"), b64("inter_nooid")]), roots), "invalid_apple_oid");
});

test("rejects certificates outside validity at signedDate", async () => {
  await rejects(verifyAppleJws(jws({ signedDate: now + 5 * 365 * 86400e3 }), roots), "certificate_not_valid");
});

test("rejects wrong alg / malformed / missing x5c", async () => {
  const [, p, s] = jws({ signedDate: now }).split(".");
  await rejects(verifyAppleJws(`${enc({ alg: "none", x5c: [b64("leaf"), b64("inter")] })}.${p}.${s}`, roots), "unsupported_algorithm");
  await rejects(verifyAppleJws(`${enc({ alg: "ES256" })}.${p}.${s}`, roots), "invalid_certificate_chain");
  await rejects(verifyAppleJws("a.b", roots), "malformed_jws");
  await rejects(verifyAppleJws("!!.??.**", roots), "malformed_jws");
});

// ---- Apple's own fixtures ----

test("REAL Apple production chain (G3 -> WWDR G6 -> signing cert) passes every chain check", async () => {
  const appleRoots = loadTrustedRoots([APPLE_ROOT_CA_G3]);
  assert.equal(apple.REAL_APPLE_ROOT_BASE64_ENCODED, APPLE_ROOT_CA_G3);
  const h = enc({ alg: "ES256", x5c: [apple.REAL_APPLE_SIGNING_CERTIFICATE_BASE64_ENCODED, apple.REAL_APPLE_INTERMEDIATE_BASE64_ENCODED] });
  const p = enc({ signedDate: 1761962975000 });
  // Chain/OID/date checks pass, so the only failure left is our dummy signature.
  await rejects(verifyAppleJws(`${h}.${p}.${Buffer.alloc(64).toString("base64url")}`, appleRoots), "invalid_jws_signature");
});

test("Apple test chain: valid + invalid-OID variants behave like Apple's library", async () => {
  const r = loadTrustedRoots([apple.ROOT_CA_BASE64_ENCODED]);
  const p = enc({ signedDate: 1700000000000 });
  const sig = Buffer.alloc(64).toString("base64url");
  const mk = (leaf: string, inter: string) => `${enc({ alg: "ES256", x5c: [leaf, inter] })}.${p}.${sig}`;
  await rejects(verifyAppleJws(mk(apple.LEAF_CERT_BASE64_ENCODED, apple.INTERMEDIATE_CA_BASE64_ENCODED), r), "invalid_jws_signature");
  await rejects(verifyAppleJws(mk(apple.LEAF_CERT_INVALID_OID_BASE64_ENCODED, apple.INTERMEDIATE_CA_BASE64_ENCODED), r), "invalid_apple_oid");
  await rejects(verifyAppleJws(mk(apple.LEAF_CERT_FOR_INTERMEDIATE_CA_INVALID_OID_BASE64_ENCODED, apple.INTERMEDIATE_CA_INVALID_OID_BASE64_ENCODED), r), "invalid_apple_oid");
  // Apple's test chain must not validate against the real Apple root.
  await rejects(verifyAppleJws(mk(apple.LEAF_CERT_BASE64_ENCODED, apple.INTERMEDIATE_CA_BASE64_ENCODED), loadTrustedRoots([APPLE_ROOT_CA_G3])), "untrusted_chain");
});
