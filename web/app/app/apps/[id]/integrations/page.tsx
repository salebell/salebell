"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { UpgradeCallout } from "@/components/app/upgrade";
import { useCurrentApp } from "@/components/app/use-current-app";
import { Alert, Badge, Button, Card, Field, Input, Skeleton } from "@/components/ui";
import { CHANNELS, channelSpec, configOf, randomSecret, type ChannelSpec } from "@/lib/channels";
import type { AppRow, Channel, Database } from "@/lib/database.types";
import { deliveryError, friendlyError, functionError, planLimitOf } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { FREE_LIMITS } from "@/lib/plans";
import { supabaseBrowser } from "@/lib/supabase/client";

type TestResult = { ok: boolean; text: string };
type Delivery = Pick<Database["public"]["Tables"]["alert_deliveries"]["Row"], "channel_id" | "ok" | "status" | "error" | "created_at">;

function LastDelivery({ delivery, now }: { delivery: Delivery | undefined; now: number }) {
  if (!delivery) return <p className="mt-3 text-xs text-muted">No deliveries yet.</p>;
  return (
    <p className={`mt-3 flex flex-wrap items-center gap-x-1.5 text-xs ${delivery.ok ? "text-muted" : "text-danger"}`}>
      <span className={`inline-block size-1.5 rounded-full ${delivery.ok ? "bg-accent" : "bg-danger"}`} aria-hidden="true" />
      <span className="font-medium">{delivery.ok ? "Last delivery succeeded" : "Last delivery failed"}</span>
      <time dateTime={delivery.created_at} title={new Date(delivery.created_at).toLocaleString()}>{timeAgo(delivery.created_at, now)}</time>
      {!delivery.ok && (delivery.status || delivery.error) && (
        <span className="min-w-0 break-words">· {deliveryError(delivery.error, delivery.status)}</span>
      )}
    </p>
  );
}
type TestResponse = {
  deliveries?: { channelId: string; ok: boolean; status?: number | null; error?: string | null }[];
  push?: { sent: number; failed: number };
};

function ChannelForm({
  spec,
  app,
  existing,
  onDone,
  onCancel,
  onLimit,
}: {
  spec: ChannelSpec;
  app: AppRow;
  existing?: Channel;
  onDone: () => void;
  onCancel: () => void;
  onLimit: () => void;
}) {
  const initial = existing ? configOf(existing.config) : {};
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(spec.fields.map((f) => [f.key, initial[f.key] ?? (f.key === "secret" && !existing ? randomSecret() : (f.defaultValue ?? ""))])),
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [envs, setEnvs] = useState<string[]>(existing?.environments ?? ["Production"]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = Object.fromEntries(
    spec.fields.map((f) => {
      const v = values[f.key]?.trim() ?? "";
      if (!v) return [f.key, f.optional ? null : "Required"];
      return [f.key, f.validate?.(v) ?? null];
    }),
  );
  const invalid = Object.values(errors).some(Boolean) || envs.length === 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    const config = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const row = { name: name.trim() || null, config, environments: envs };
    const supabase = supabaseBrowser();
    const { error } = existing
      ? await supabase.from("alert_channels").update(row).eq("id", existing.id)
      : await supabase.from("alert_channels").insert({ ...row, app_id: app.id, kind: spec.kind });
    setBusy(false);
    if (error) {
      if (planLimitOf(error) === "channels") return onLimit();
      return setError(friendlyError(error));
    }
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <p className="text-sm text-muted">{spec.help}</p>
      {spec.fields.map((f) => {
        const id = `${existing?.id ?? "new"}-${f.key}`;
        const err = touched ? errors[f.key] : null;
        return (
          <Field key={f.key} label={f.label} htmlFor={id} error={err}>
            <div className="flex gap-2">
              <Input
                id={id}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={f.mono ? "font-mono text-[0.8125rem]" : ""}
                aria-invalid={!!err}
                aria-describedby={err ? `${id}-error` : undefined}
              />
              {f.key === "secret" && (
                <Button type="button" variant="secondary" onClick={() => setValues((v) => ({ ...v, secret: randomSecret() }))}>
                  Generate
                </Button>
              )}
            </div>
          </Field>
        );
      })}
      <Field label="Label (optional)" htmlFor={`${existing?.id ?? "new"}-name`} hint="Helps you tell integrations apart, like “#sales”.">
        <Input id={`${existing?.id ?? "new"}-name`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Environments</legend>
        <div className="flex flex-wrap gap-4">
          {["Production", "Sandbox"].map((env) => (
            <label key={env} className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={envs.includes(env)}
                onChange={(e) => setEnvs((cur) => (e.target.checked ? [...cur, env] : cur.filter((x) => x !== env)))}
              />
              {env}
            </label>
          ))}
        </div>
        {touched && envs.length === 0 && <p className="mt-1.5 text-xs font-medium text-danger">Pick at least one environment.</p>}
      </fieldset>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {existing ? "Save changes" : `Add ${spec.label}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ChannelCard({
  channel,
  app,
  paused,
  canManage,
  onChanged,
  lastDelivery,
  now,
}: {
  channel: Channel;
  app: AppRow;
  paused: boolean;
  canManage: boolean;
  onChanged: () => void;
  lastDelivery: Delivery | undefined;
  now: number;
}) {
  const spec = channelSpec(channel.kind);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function test() {
    setTesting(true);
    setResult(null);
    const { data, error } = await supabaseBrowser().functions.invoke<TestResponse>("test-alert", {
      body: { app_id: app.id, channel_id: channel.id },
    });
    setTesting(false);
    onChanged();
    if (error) return setResult({ ok: false, text: await functionError(error, "Couldn't send a test alert.") });
    const d = data?.deliveries?.find((x) => x.channelId === channel.id);
    if (!d) return setResult({ ok: false, text: "Not sent. Check that this integration is turned on and its settings are complete." });
    if (d.error === "plan_limit:channels" || d.error === "paused_on_free")
      return setResult({ ok: false, text: "Not sent: this integration is paused on the Free plan." });
    setResult(
      d.ok
        ? { ok: true, text: `Delivered${d.status ? ` (HTTP ${d.status})` : ""}. Check ${spec?.label ?? "the channel"}.` }
        : { ok: false, text: `Failed: ${deliveryError(d.error, d.status)}.` },
    );
  }

  async function toggle() {
    setBusy(true);
    const { error } = await supabaseBrowser().from("alert_channels").update({ enabled: !channel.enabled }).eq("id", channel.id);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onChanged();
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabaseBrowser().from("alert_channels").delete().eq("id", channel.id);
    setBusy(false);
    if (error) return setError(friendlyError(error));
    onChanged();
  }

  if (!spec) return null;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-lg" aria-hidden="true">
            {spec.emoji}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {channel.name || spec.label}
              {!channel.enabled ? <Badge>Off</Badge> : paused ? <Badge tone="warn">Paused on Free</Badge> : <Badge tone="accent">On</Badge>}
            </p>
            <p className="truncate font-mono text-xs text-muted">
              {spec.label} · {spec.summary(configOf(channel.config))} · {channel.environments.join(" + ")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={testing} onClick={test} disabled={!channel.enabled}>
            Send test alert
          </Button>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
              Edit
            </Button>
          )}
        </div>
      </div>
      <LastDelivery delivery={lastDelivery} now={now} />
      {result && (
        <div className="mt-3">
          <Alert tone={result.ok ? "accent" : "danger"}>{result.text}</Alert>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {editing && canManage && (
        <div className="mt-5 space-y-5 border-t border-border pt-5">
          <ChannelForm
            spec={spec}
            app={app}
            existing={channel}
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
            onCancel={() => setEditing(false)}
            onLimit={() => setError("Your plan's integration limit was reached.")}
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button variant="secondary" size="sm" loading={busy} onClick={toggle}>
              {channel.enabled ? "Turn off" : "Turn on"}
            </Button>
            {confirmDelete ? (
              <>
                <Button variant="danger" size="sm" loading={busy} onClick={remove}>
                  Yes, delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function IntegrationsPage() {
  const { app, ws, isPro, canManage } = useCurrentApp();
  const now = useNow();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [deliveries, setDeliveries] = useState<Map<string, Delivery>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ChannelSpec | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const appIds = ws.apps.map((a) => a.id).join(",");
  const appId = app?.id;

  const load = useCallback(async () => {
    // Load the whole workspace's channels: the Free limit counts across apps.
    const supabase = supabaseBrowser();
    const [{ data, error }, { data: recent }] = await Promise.all([
      supabase.from("alert_channels").select("*").in("app_id", appIds.split(",")).order("created_at"),
      appId
        ? supabase
            .from("alert_deliveries")
            .select("channel_id, ok, status, error, created_at")
            .eq("app_id", appId)
            .not("channel_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [] as Delivery[] }),
    ]);
    if (error) setError(friendlyError(error));
    setChannels(data ?? []);
    // Newest first, so the first row seen per channel is its latest delivery.
    const latest = new Map<string, Delivery>();
    for (const d of recent ?? []) if (d.channel_id && !latest.has(d.channel_id)) latest.set(d.channel_id, d);
    setDeliveries(latest);
  }, [appIds, appId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
  }, [load]);

  if (!app) return null;
  const mine = channels?.filter((c) => c.app_id === app.id) ?? [];
  const activeIds = new Set((channels ?? []).filter((c) => c.enabled).slice(0, FREE_LIMITS.channels).map((c) => c.id));
  const atLimit = !isPro && (channels?.length ?? 0) >= FREE_LIMITS.channels;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Integrations</h2>
        <p className="mt-1 text-[0.9375rem] text-muted">
          Send {app.name}&apos;s events to the places you already look. iPhone alerts come from the Salebell app and don&apos;t count
          as an integration.
          {!isPro && " The Free plan includes one integration across your workspace."}
        </p>
      </div>

      {error && <Alert>{error}</Alert>}

      {channels === null ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : mine.length > 0 ? (
        <div className="space-y-3">
          {mine.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              app={app}
              paused={!isPro && c.enabled && !activeIds.has(c.id)}
              canManage={canManage}
              onChanged={load}
              lastDelivery={deliveries.get(c.id)}
              now={now}
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed p-6 text-center">
          <p className="font-medium">No integrations yet</p>
          <p className="mt-1 text-sm text-muted">Pick one below. Each has a test button so you know it works before a real purchase.</p>
        </Card>
      )}

      {canManage && channels !== null && (
        <section aria-labelledby="add-integration">
          <h3 id="add-integration" className="mb-3 font-semibold">
            Add an integration
          </h3>
          {atLimit || limitHit ? (
            <UpgradeCallout reason="channels" />
          ) : adding ? (
            <Card className="p-5">
              <p className="mb-4 flex items-center gap-2 font-medium">
                <span aria-hidden="true">{adding.emoji}</span> {adding.label}
              </p>
              <ChannelForm
                spec={adding}
                app={app}
                onDone={() => {
                  setAdding(null);
                  load();
                }}
                onCancel={() => setAdding(null)}
                onLimit={() => {
                  setAdding(null);
                  setLimitHit(true);
                }}
              />
            </Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {CHANNELS.filter((spec) => !spec.hidden).map((spec) => (
                <button
                  key={spec.kind}
                  type="button"
                  onClick={() => setAdding(spec)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-base" aria-hidden="true">
                    {spec.emoji}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{spec.label}</span>
                    <span className="block truncate text-xs text-muted">{spec.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-muted">
            Payload format for webhooks is in the <Link href="/docs#webhook-format" className="underline underline-offset-2">docs</Link>.
          </p>
        </section>
      )}
    </div>
  );
}
