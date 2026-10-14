import assert from "node:assert/strict";
import { test } from "node:test";
import { isSalebellReceiver } from "../supabase/functions/_shared/core/receiver-url.ts";

const hosts = { siteUrl: "https://app.salebell.example", supabaseUrl: "https://salebell-project.supabase.co" };

test("receiver identity compares exact project hosts and receiver paths", () => {
  for (const url of [
    "https://app.salebell.example/hooks/apple/old-key/production",
    "https://salebell-project.supabase.co/functions/v1/apple-webhook/old-key/production",
    "https://SALEBELL-PROJECT.supabase.co./functions/v1/apple-webhook/old-key/production",
    "https://salebell-project.supabase.co/functions/v1/%61pple-webhook/old-key/production",
    "https://salebell.vercel.app/hooks/apple/old-key/production",
  ]) assert.equal(isSalebellReceiver(url, hosts), true, url);
  for (const url of [
    "https://customer-project.supabase.co/functions/v1/apple-webhook/customer/production",
    "https://customer-project.supabase.co/functions/v1/apple-notifications",
    "https://salebell-project.supabase.co/functions/v1/customer-notifications",
    "https://customer.vercel.app/hooks/apple/customer/production",
    "https://salebell-project.supabase.co.customer.example/functions/v1/apple-webhook/customer/production",
    "https://app.salebell.example/other-notifications",
  ]) assert.equal(isSalebellReceiver(url, hosts), false, url);
});

test("self-hosted receiver identity recognizes public backend prefixes and internal gateway URLs", () => {
  const selfHosted = {
    siteUrl: "https://salebell.example",
    supabaseUrl: "https://salebell.example/backend",
    internalSupabaseUrl: "http://gateway:8000",
  };
  for (const url of [
    "https://salebell.example/backend/functions/v1/apple-webhook/key/production",
    "https://salebell.example/functions/v1/apple-webhook/key/production",
    "http://gateway:8000/functions/v1/apple-webhook/key/production",
    "https://salebell.example/hooks/apple/key/production",
  ]) assert.equal(isSalebellReceiver(url, selfHosted), true, url);
  for (const url of [
    "https://customer.example/backend/functions/v1/apple-webhook/key/production",
    "https://salebell.example/backend/functions/v1/customer-receiver",
  ]) assert.equal(isSalebellReceiver(url, selfHosted), false, url);
});
