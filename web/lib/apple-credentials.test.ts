import assert from "node:assert/strict";
import { test } from "node:test";
import { appleCredentialMetadataError, appleKeyIdFromFilename, MAX_APPLE_CREDENTIAL_BYTES, parseAppleCredentialFile } from "./apple-credentials.ts";

const key = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(160)}\n-----END PRIVATE KEY-----`;
const metadata = { key_id: "ABCDE12345", issuer_id: "57246542-96fe-1a63-e053-0824d011072a" };

test("Apple key filename inference accepts only a full AuthKey filename", () => {
  assert.equal(appleKeyIdFromFilename("AuthKey_ABCDE12345.p8"), "ABCDE12345");
  assert.equal(appleKeyIdFromFilename("authkey_abcde12345.P8"), "ABCDE12345");
  assert.equal(appleKeyIdFromFilename("SubscriptionKey_ABCDE12345.p8"), "ABCDE12345");
  assert.equal(appleKeyIdFromFilename("APNs_ABCDE12345.p8"), "");
  assert.equal(appleKeyIdFromFilename("AuthKey_ABCDE12345.p8.backup"), "");
});

test("p8 import infers metadata without requiring an issuer in the file", () => {
  assert.deepEqual(parseAppleCredentialFile("AuthKey_ABCDE12345.p8", key.replaceAll("\n", "\r\n")), {
    key_id: metadata.key_id, issuer_id: undefined, private_key: key,
  });
});

test("JSON import supports explicit and fastlane credential fields", () => {
  assert.deepEqual(parseAppleCredentialFile("apple.json", JSON.stringify({ ...metadata, private_key: key })), { ...metadata, private_key: key });
  assert.deepEqual(parseAppleCredentialFile("fastlane.json", JSON.stringify({ ...metadata, key: btoa(key), is_key_content_base64: true })), { ...metadata, private_key: key });
  assert.deepEqual(parseAppleCredentialFile("apple.json", JSON.stringify({ keyId: metadata.key_id, issuerId: metadata.issuer_id, privateKey: key })), { ...metadata, private_key: key });
});

test("malformed, oversized or non-key uploads fail without echoing contents", () => {
  for (const [name, contents] of [
    ["apple.json", "SECRET_DO_NOT_ECHO"],
    ["apple.json", "[]"],
    ["apple.json", JSON.stringify({ ...metadata, private_key: "SECRET_DO_NOT_ECHO" })],
    ["apple.p8", "x".repeat(MAX_APPLE_CREDENTIAL_BYTES + 1)],
    ["apple.p8", `-----BEGIN PRIVATE KEY-----\n${"A".repeat(4_000)}\n-----END PRIVATE KEY-----`],
    ["apple.txt", key],
  ]) {
    assert.throws(() => parseAppleCredentialFile(name, contents), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("SECRET_DO_NOT_ECHO"), false);
      return true;
    });
  }
});

test("metadata validation requires an Apple key ID and issuer UUID", () => {
  assert.equal(appleCredentialMetadataError(metadata.key_id, metadata.issuer_id), null);
  assert.ok(appleCredentialMetadataError("ABCDE", metadata.issuer_id));
  assert.ok(appleCredentialMetadataError(metadata.key_id, "someone@example.com"));
});
