import assert from "node:assert/strict";
import { test } from "node:test";
import { appleIssuerChoices, suggestedAppleIssuer } from "./apple-issuer.ts";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const key = (key_id: string, issuer_id = first) => ({ key_id, issuer_id, label: `Team ${key_id}` });

test("setup and purchase keys share one saved Apple team identifier", () => {
  const metadata = [key("SETUP12345"), key("PURCHASE12")];
  assert.equal(appleIssuerChoices(metadata).length, 1);
  assert.equal(suggestedAppleIssuer(metadata, "NEWKEY1234"), first);
});

test("a known key selects its own issuer when several Apple teams are saved", () => {
  const metadata = [key("SETUP12345"), key("OTHER12345", second)];
  assert.equal(suggestedAppleIssuer(metadata, "OTHER12345", first), second);
  assert.equal(suggestedAppleIssuer(metadata, "NEWKEY1234", first), null);
  assert.equal(suggestedAppleIssuer([...metadata, key("OTHER12345")], "OTHER12345"), null);
});

test("only valid remembered team identifiers are reused without saved keys", () => {
  assert.equal(suggestedAppleIssuer([], "", first), first);
  assert.equal(suggestedAppleIssuer([], "", "corrupt or private key data"), null);
  assert.equal(suggestedAppleIssuer([key("INVALID123", "bad")], "", first), first);
});
