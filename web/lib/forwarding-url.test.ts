import assert from "node:assert/strict";
import { test } from "node:test";
import { forwardingUrlError } from "./forwarding-url.ts";

const hosts = { siteUrl: "https://app.salebell.example", supabaseUrl: "https://salebell-project.supabase.co" };

test("forwarding accepts another Supabase project's functions, including apple-webhook", () => {
  for (const url of [
    "https://customer-project.supabase.co/functions/v1/apple-notifications",
    "https://customer-project.supabase.co/functions/v1/apple-webhook/customer/production",
    "https://salebell-project.supabase.co/functions/v1/customer-notifications",
    "https://customer.vercel.app/hooks/apple/customer/production",
  ]) assert.equal(forwardingUrlError(url, hosts), null, url);
});

test("forwarding blocks only Salebell's site and project receivers", () => {
  for (const url of [
    "https://app.salebell.example/hooks/apple/customer/production",
    "https://salebell-project.supabase.co/functions/v1/apple-webhook/customer/production",
    "https://SALEBELL-PROJECT.supabase.co./functions/v1/apple-webhook/customer/production",
    "https://salebell-project.supabase.co/functions/v1/%61pple-webhook/customer/production",
    "https://salebell.vercel.app/hooks/apple/customer/production",
  ]) assert.match(forwardingUrlError(url, hosts)!, /forwarding loop/, url);
});

test("optional forwarding keeps the outbound URL restrictions", () => {
  assert.equal(forwardingUrlError("", hosts), null);
  for (const url of ["http://customer-project.supabase.co/apple", "https://127.0.0.1/apple", "not a URL"]) {
    assert.notEqual(forwardingUrlError(url, hosts), null, url);
  }
});

test("forwarding blocks this instance's receiver beneath an API path prefix", () => {
  const prefixedHosts = { ...hosts, supabaseUrl: "https://app.salebell.example/backend" };
  for (const url of [
    "https://app.salebell.example/backend/functions/v1/apple-webhook/customer/production",
    "https://app.salebell.example/backend/functions/v1/%61pple-webhook/customer/production",
    "https://app.salebell.example/functions/v1/apple-webhook/customer/production",
  ]) assert.match(forwardingUrlError(url, prefixedHosts)!, /forwarding loop/, url);
  assert.equal(forwardingUrlError("https://app.salebell.example/backend/functions/v1/customer-notifications", prefixedHosts), null);
  assert.equal(forwardingUrlError("https://customer.example/backend/functions/v1/apple-webhook/customer/production", prefixedHosts), null);
});
