import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";

const run = promisify(execFile);
const SCRIPT = new URL("../scripts/stripe-setup.mjs", import.meta.url).pathname;

type Obj = Record<string, any>;

/** In-memory subset of the Stripe API used by the setup script. */
function fakeStripe(seed: { prices?: Obj[]; products?: Obj[] } = {}) {
  const products = new Map<string, Obj>((seed.products ?? []).map((p) => [p.id, p]));
  const prices: Obj[] = seed.prices ?? [];
  const coupons = new Map<string, Obj>();
  const promos: Obj[] = [];
  const hooks: Obj[] = [];
  const versions = new Set<string>();
  let n = 0;
  const server = createServer(async (req, res) => {
    versions.add(String(req.headers["stripe-version"]));
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const form = Object.fromEntries(new URLSearchParams(raw));
    const url = new URL(req.url!, "http://x");
    const parts = url.pathname.split("/").slice(2); // after /v1
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const notFound = () => send(404, { error: { message: "No such object" } });
    const [kind, id] = parts;
    if (kind === "products") {
      if (req.method === "GET") return products.has(id) ? send(200, products.get(id)) : notFound();
      if (id) { Object.assign(products.get(id)!, form); return send(200, products.get(id)); }
      products.set(form.id, { ...form }); return send(200, form);
    }
    if (kind === "prices") {
      if (req.method === "GET") {
        const keys = url.searchParams.getAll("lookup_keys[]");
        return send(200, { data: prices.filter((p) => p.active && keys.includes(p.lookup_key)) });
      }
      if (id) { prices.find((p) => p.id === id)!.active = form.active === "true"; return send(200, {}); }
      if (form.transfer_lookup_key === "true") for (const p of prices) if (p.lookup_key === form.lookup_key) p.lookup_key = null;
      const price = { id: `price_${++n}`, active: true, product: form.product, currency: form.currency, unit_amount: Number(form.unit_amount),
        recurring: { interval: form["recurring[interval]"] }, lookup_key: form.lookup_key };
      prices.push(price); return send(200, price);
    }
    if (kind === "coupons") {
      if (req.method === "GET") return coupons.has(id) ? send(200, coupons.get(id)) : notFound();
      const c = { id: form.id, percent_off: Number(form.percent_off), duration: form.duration, max_redemptions: Number(form.max_redemptions), name: form.name };
      coupons.set(c.id, c); return send(200, c);
    }
    if (kind === "promotion_codes") {
      if (req.method === "GET") return send(200, { data: promos.filter((p) => p.code === url.searchParams.get("code")) });
      const p = { id: `promo_${++n}`, code: form.code, active: true, coupon: coupons.get(form.coupon) };
      promos.push(p); return send(200, p);
    }
    if (kind === "webhook_endpoints") {
      if (req.method === "GET") return send(200, { data: hooks });
      const h = { id: `we_${++n}`, url: form.url, secret: "whsec_new", events: Object.keys(form).filter((k) => k.startsWith("enabled_events")).map((k) => form[k]) };
      hooks.push(h); return send(200, h);
    }
    send(400, { error: { message: `unhandled ${req.method} ${url.pathname}` } });
  });
  return { server, products, prices, coupons, promos, hooks, versions };
}

async function setup(fake: ReturnType<typeof fakeStripe>) {
  await new Promise<void>((r) => fake.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  const exec = (args: string[] = []) => run(process.execPath, [SCRIPT, ...args], { env: { ...process.env, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_API_BASE: base, STRIPE_WEBHOOK_URL: "https://test-project.supabase.co/functions/v1/stripe-webhook" } });
  return { exec, close: () => fake.server.close() };
}

test("stripe-setup creates Salebell Pro, $9/$79 prices, FOUNDER coupon and code, webhook; reruns are no-ops", async () => {
  const fake = fakeStripe();
  const { exec, close } = await setup(fake);
  try {
    const first = await exec();
    assert.equal(fake.products.get("salebell_pro")?.name, "Salebell Pro");
    const active = fake.prices.filter((p) => p.active);
    assert.deepEqual(active.map((p) => [p.lookup_key, p.unit_amount, p.recurring.interval]),
      [["pro_monthly", 900, "month"], ["pro_yearly", 7900, "year"]]);
    assert.deepEqual(fake.coupons.get("FOUNDER"), { id: "FOUNDER", percent_off: 33, duration: "forever", max_redemptions: 100, name: "Founding member" });
    assert.deepEqual(fake.promos.map((p) => [p.code, p.coupon.id]), [["FOUNDER", "FOUNDER"]]);
    assert.equal(fake.hooks.length, 1);
    assert.equal(fake.hooks[0].events.length, 4);
    assert.match(first.stdout, /STRIPE_PRICE_MONTHLY=price_\d+\nSTRIPE_PRICE_YEARLY=price_\d+\nSTRIPE_WEBHOOK_SECRET=whsec_new/);
    assert.deepEqual([...fake.versions], ["2024-06-20"], "API version pinned");

    const second = await exec();
    assert.equal(fake.prices.length, 2, "no duplicate prices");
    assert.equal(fake.promos.length, 1, "no duplicate promotion codes");
    assert.equal(fake.hooks.length, 1, "no duplicate webhook endpoints");
    assert.match(second.stdout, /Coupon FOUNDER exists\.\nPromotion code FOUNDER exists\./);
  } finally {
    close();
  }
});

test("stripe-setup requires an explicit webhook target before making API calls", async () => {
  await assert.rejects(run(process.execPath, [SCRIPT], { env: { ...process.env, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_URL: "", STRIPE_API_BASE: "http://127.0.0.1:1" } }), /Set STRIPE_WEBHOOK_URL/);
});

test("stripe-setup --no-webhook only configures products and prices", async () => {
  const fake = fakeStripe();
  const { exec, close } = await setup(fake);
  try {
    await exec(["--no-webhook"]);
    assert.equal(fake.products.size, 1);
    assert.equal(fake.prices.length, 2);
    assert.equal(fake.hooks.length, 0);
  } finally { close(); }
});

test("stripe-setup replaces an old $90/year price and transfers its lookup key", async () => {
  const fake = fakeStripe({
    products: [{ id: "salebell_pro", name: "Previous product name", description: "old" }],
    prices: [
      { id: "price_m_old", active: true, product: "salebell_pro", currency: "usd", unit_amount: 900, recurring: { interval: "month" }, lookup_key: "pro_monthly" },
      { id: "price_y_old", active: true, product: "salebell_pro", currency: "usd", unit_amount: 9000, recurring: { interval: "year" }, lookup_key: "pro_yearly" },
    ],
  });
  const { exec, close } = await setup(fake);
  try {
    const { stdout } = await exec();
    assert.equal(fake.products.get("salebell_pro")?.name, "Salebell Pro", "product renamed");
    const old = fake.prices.find((p) => p.id === "price_y_old")!;
    assert.deepEqual([old.active, old.lookup_key], [false, null], "old yearly price archived, key transferred");
    const yearly = fake.prices.find((p) => p.lookup_key === "pro_yearly")!;
    assert.deepEqual([yearly.unit_amount, yearly.active], [7900, true]);
    assert.equal(fake.prices.find((p) => p.id === "price_m_old")!.active, true, "matching monthly price kept");
    assert.match(stdout, new RegExp(`STRIPE_PRICE_MONTHLY=price_m_old\\nSTRIPE_PRICE_YEARLY=${yearly.id}\\n`));
  } finally {
    close();
  }
});
