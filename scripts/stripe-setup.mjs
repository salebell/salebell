#!/usr/bin/env node
// Idempotently sets up Stripe for Salebell:
// - product "Salebell Pro" with $9/month and $79/year prices (lookup keys pro_monthly / pro_yearly);
//   a price with a different amount is replaced and its lookup key transferred to the new price
// - coupon FOUNDER (33% off forever, first 100 redemptions) and promotion code FOUNDER
// - unless --no-webhook is given, the webhook endpoint for the stripe-webhook function
// Prints the values to set as Supabase Edge Function secrets.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//   STRIPE_WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/stripe-webhook (required unless --no-webhook)
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (test or live secret key).");
  process.exit(1);
}
const webhookUrl = process.env.STRIPE_WEBHOOK_URL;
if (!process.argv.includes("--no-webhook")) {
  try {
    const url = new URL(webhookUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch {
    console.error("Set STRIPE_WEBHOOK_URL to the HTTPS stripe-webhook endpoint for your project, or pass --no-webhook.");
    process.exit(1);
  }
}
const API = process.env.STRIPE_API_BASE ?? "https://api.stripe.com"; // overridable for tests
// Pinned so coupon and promotion-code parameters keep the shape used below.
const STRIPE_VERSION = "2024-06-20";
const PRODUCT = { id: "salebell_pro", name: "Salebell Pro", description: "Unlimited apps and integrations, full dashboard history, CSV export." };
const PRICES = [
  { lookup_key: "pro_monthly", unit_amount: 900, interval: "month", nickname: "Pro monthly", secret: "STRIPE_PRICE_MONTHLY" },
  { lookup_key: "pro_yearly", unit_amount: 7900, interval: "year", nickname: "Pro yearly", secret: "STRIPE_PRICE_YEARLY" },
];
const COUPON = { id: "FOUNDER", percent_off: 33, duration: "forever", max_redemptions: 100, name: "Founding member" };
const PROMO_CODE = "FOUNDER";
const EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];

async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(params) : undefined;
  const res = await fetch(`${API}/v1/${path}`, {
    method, body,
    headers: {
      authorization: `Bearer ${key}`, "stripe-version": STRIPE_VERSION,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`${method} ${path}: ${data.error?.message ?? res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function getOrNull(path) {
  try {
    return await stripe("GET", path);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// ---------- product ----------
let product = await getOrNull(`products/${PRODUCT.id}`);
if (!product) {
  product = await stripe("POST", "products", PRODUCT);
  console.log(`Created product ${PRODUCT.id}.`);
} else if (product.name !== PRODUCT.name || product.description !== PRODUCT.description) {
  product = await stripe("POST", `products/${PRODUCT.id}`, { name: PRODUCT.name, description: PRODUCT.description });
  console.log(`Updated product ${PRODUCT.id}.`);
} else {
  console.log(`Product ${PRODUCT.id} exists.`);
}

// ---------- prices ----------
const out = {};
for (const p of PRICES) {
  const found = await stripe("GET", `prices?active=true&lookup_keys[]=${p.lookup_key}`);
  const current = found.data[0];
  const matches = current && current.product === product.id && current.unit_amount === p.unit_amount &&
    current.currency === "usd" && current.recurring?.interval === p.interval;
  if (matches) {
    console.log(`Price ${p.lookup_key} exists (${current.id}).`);
    out[p.secret] = current.id;
    continue;
  }
  // transfer_lookup_key moves the key from the old price; existing subscriptions keep their old price.
  const price = await stripe("POST", "prices", {
    product: product.id, currency: "usd", unit_amount: String(p.unit_amount), "recurring[interval]": p.interval,
    lookup_key: p.lookup_key, transfer_lookup_key: "true", nickname: p.nickname,
  });
  console.log(`Created price ${p.lookup_key} (${price.id}, $${p.unit_amount / 100}/${p.interval}).`);
  if (current) {
    await stripe("POST", `prices/${current.id}`, { active: "false" });
    console.log(`Archived previous ${p.lookup_key} price ${current.id} ($${current.unit_amount / 100}).`);
  }
  out[p.secret] = price.id;
}

// ---------- founder coupon + promotion code ----------
const coupon = await getOrNull(`coupons/${COUPON.id}`);
if (!coupon) {
  await stripe("POST", "coupons", {
    id: COUPON.id, percent_off: String(COUPON.percent_off), duration: COUPON.duration,
    max_redemptions: String(COUPON.max_redemptions), name: COUPON.name,
  });
  console.log(`Created coupon ${COUPON.id} (${COUPON.percent_off}% off ${COUPON.duration}, max ${COUPON.max_redemptions}).`);
} else if (coupon.percent_off !== COUPON.percent_off || coupon.duration !== COUPON.duration || coupon.max_redemptions !== COUPON.max_redemptions) {
  // Coupon terms are immutable in Stripe; fixing them means deleting and recreating it by hand.
  console.warn(`Coupon ${COUPON.id} exists with different terms (${coupon.percent_off}% ${coupon.duration}, max ${coupon.max_redemptions}); left unchanged.`);
} else {
  console.log(`Coupon ${COUPON.id} exists.`);
}
const promos = await stripe("GET", `promotion_codes?code=${PROMO_CODE}&limit=10`);
if (promos.data.some((c) => c.active && c.coupon?.id === COUPON.id)) {
  console.log(`Promotion code ${PROMO_CODE} exists.`);
} else {
  await stripe("POST", "promotion_codes", { coupon: COUPON.id, code: PROMO_CODE });
  console.log(`Created promotion code ${PROMO_CODE}.`);
}

// ---------- webhook endpoint ----------
if (!process.argv.includes("--no-webhook")) {
  const endpoints = await stripe("GET", "webhook_endpoints?limit=100");
  const existing = endpoints.data.find((w) => w.url === webhookUrl);
  if (existing) {
    console.log(`Webhook endpoint for ${webhookUrl} exists (${existing.id}); reveal its signing secret in the Stripe dashboard.`);
  } else {
    const params = { url: webhookUrl, description: "Salebell plan sync" };
    EVENTS.forEach((e, i) => { params[`enabled_events[${i}]`] = e; });
    const created = await stripe("POST", "webhook_endpoints", params);
    out.STRIPE_WEBHOOK_SECRET = created.secret;
    console.log(`Created webhook endpoint ${created.id}.`);
  }
}

console.log("\nSet these as Supabase Edge Function secrets:");
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
