"use client";

import { useEffect, useRef, useState } from "react";
import { count, shortDate, usd, usdCompact } from "@/lib/format";
import type { Bucket } from "@/lib/revenue";

const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function niceMax(v: number) {
  if (v <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;

function rangeLabel(b: Bucket) {
  return b.start === b.end ? shortDate(b.start) : `${shortDate(b.start)} – ${shortDate(b.end)}`;
}

export function RevenueChart({ data, title }: { data: Bucket[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real width so labels stay legible on phones.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const values = data.map((b) => b.stats.usd);
  const max = niceMax(Math.max(0, ...values));
  const min = Math.min(0, ...values) < 0 ? -niceMax(-Math.min(...values)) : 0;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((max - v) / (max - min)) * innerH;
  const step = innerW / data.length;
  const barW = Math.max(2, Math.min(18, step * 0.68));
  // Gridlines at the extremes and zero (or the midpoint); drop the negative label when it would crowd $0.
  const ticks = [min, min < 0 ? 0 : max / 2, max].filter((v, i, a) => a.indexOf(v) === i && !(v < 0 && y(v) - y(0) < 22));
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 72)));
  const empty = values.every((v) => v === 0);
  const active = hover != null ? data[hover] : null;

  return (
    <div className="relative" ref={wrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full"
        role="img"
        aria-label={`${title}. ${empty ? "No revenue in this period." : `Peak ${usd(Math.max(...values))}.`} A table with the same data follows.`}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-muted text-[11px]">
              {usdCompact(t)}
            </text>
          </g>
        ))}
        {data.map((b, i) => {
          const v = b.stats.usd;
          const x = PAD.left + i * step + (step - barW) / 2;
          const top = y(Math.max(v, 0));
          const h = Math.max(v === 0 ? 0 : 1.5, Math.abs(y(v) - y(0)));
          return (
            <g key={b.start} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.left + i * step} y={PAD.top} width={step} height={innerH} fill="transparent" />
              <rect
                x={x}
                y={top}
                width={barW}
                height={h}
                rx={Math.min(3, barW / 3)}
                fill={v < 0 ? "var(--danger)" : "var(--accent)"}
                opacity={hover == null || hover === i ? 1 : 0.45}
              />
              {i % labelEvery === 0 && (
                <text x={PAD.left + i * step + step / 2} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">
                  {shortDate(b.start)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-48 rounded-lg border border-border bg-surface p-3 text-xs shadow-lg"
          style={{ left: `clamp(0px, calc(${((PAD.left + (hover! + 0.5) * step) / W) * 100}% - 6rem), calc(100% - 12rem))` }}
        >
          <p className="font-medium">{rangeLabel(active)}</p>
          <p className="tnum mt-1 text-base font-semibold">{usd(active.stats.usd)}</p>
          <p className="tnum mt-1 text-muted">
            {plural(active.stats.purchases, "purchase")} · {plural(active.stats.renewals, "renewal")}
            <br />
            {plural(active.stats.trials, "trial")} · {plural(active.stats.refunds, "refund")}
          </p>
        </div>
      )}
      {empty && (
        <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-sm text-muted">No revenue in this period yet</p>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-fg">View as table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-border">
          <table className="tnum w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Period (UTC)</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Gross USD</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Purchases</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Refunds</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((b) => (
                <tr key={b.start} className="border-t border-border">
                  <td className="px-3 py-1.5">{rangeLabel(b)}</td>
                  <td className="px-3 py-1.5 text-right">{usd(b.stats.usd)}</td>
                  <td className="px-3 py-1.5 text-right">{count(b.stats.purchases)}</td>
                  <td className="px-3 py-1.5 text-right">{count(b.stats.refunds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
