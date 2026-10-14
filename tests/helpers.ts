// Signs App Store-shaped JWS with the synthetic test PKI in tests/fixtures.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadTrustedRoots } from "../supabase/functions/_shared/core/apple_jws.ts";

const PKI = new URL("./fixtures", import.meta.url).pathname;
export const b64 = (n: string) => readFileSync(`${PKI}/${n}.b64`, "utf8").trim();
const leafKey = createPrivateKey(readFileSync(`${PKI}/leaf-test-key.pem`));
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function jws(payload: object, x5c: string[] = [b64("leaf"), b64("inter"), b64("root")]): string {
  const h = enc({ alg: "ES256", x5c });
  const p = enc(payload);
  const sig = sign("sha256", Buffer.from(`${h}.${p}`), { key: leafKey, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${sig.toString("base64url")}`;
}

export const testRoots = loadTrustedRoots([b64("root")]);
export const silent = { log() {}, warn() {}, error() {} };
