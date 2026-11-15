"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";

/** Formats sérialisables (les fonctions ne traversent pas la frontière serveur → client). */
type ValueKind = "money" | "count";
const fmt = (kind: ValueKind) => (v: number) => (kind === "money" ? formatMoney(v) : new Intl.NumberFormat("fr-FR").format(v));
const axisFmt = (kind: ValueKind) => (v: number) =>
  kind === "money" ? (v >= 100000 ? `${Math.round(v / 100000)} k€` : `${Math.round(v / 100)} €`) : Number.isInteger(v) ? String(v) : v.toFixed(1);

/**
 * Graphiques du back-office — SVG accessibles, sans bibliothèque.
 * Palette catégorielle validée (outil dataviz) : bleu / orange, avec un pas
 * dédié au mode sombre. Le texte n'utilise jamais la couleur des séries.
 */
const VIZ_STYLE = `
.packio-viz { --series-1:#2a78d6; --series-2:#eb6834; --viz-grid:color-mix(in oklch,var(--foreground) 9%,transparent); --viz-surface:var(--card); }
.dark .packio-viz { --series-1:#3987e5; --series-2:#d95926; }
`;

export function VizStyle() {
  return <style dangerouslySetInnerHTML={{ __html: VIZ_STYLE }} />;
}

type Series = { key: string; label: string; color: "1" | "2" };

/** Graduations « rondes » (1, 2, 2,5, 5 × 10ⁿ) couvrant la valeur maximale. */
function niceTicks(rawMax: number, integer: boolean): { max: number; ticks: number[] } {
  const target = Math.max(rawMax, integer ? 1 : 0) / 4;
  if (target <= 0) return { max: 1, ticks: [0, 1] };
  const exp = Math.pow(10, Math.floor(Math.log10(target)));
  const f = target / exp;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  if (integer) step = Math.max(1, Math.ceil(step));
  const count = Math.max(1, Math.ceil(rawMax / step));
  const ticks = Array.from({ length: count + 1 }, (_, i) => Math.round(i * step * 100) / 100);
  return { max: count * step, ticks };
}

function Legend({ series, kind }: { series: Series[]; kind: "rect" | "line" }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          {kind === "rect" ? (
            <span className="size-2.5 rounded-[3px]" style={{ background: `var(--series-${s.color})` }} aria-hidden />
          ) : (
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: `var(--series-${s.color})` }} aria-hidden />
          )}
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {columns.map((c, i) => (
              <th key={c} className={cn("px-3 py-2 font-medium", i === 0 ? "text-left" : "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, i) => (
                <td key={i} className={cn("px-3 py-1.5 tabular", i === 0 ? "text-left" : "text-right")}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartFrame({ title, description, legend, children, table }: { title: string; description?: string; legend?: React.ReactNode; children: React.ReactNode; table: React.ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="packio-viz space-y-3">
      <figcaption className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {showTable ? "Voir le graphique" : "Voir les données"}
        </button>
      </figcaption>
      {legend}
      {showTable ? table : children}
    </figure>
  );
}

const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 44 };

/** Colonnes empilées (ex. revenus mensuels : abonnements + recharges). */
export function StackedColumns({
  title,
  description,
  data,
  series,
  valueKind = "count",
}: {
  title: string;
  description?: string;
  data: { label: string; values: Record<string, number> }[];
  series: Series[];
  valueKind?: ValueKind;
}) {
  const format = fmt(valueKind);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const { max, ticks } = niceTicks(Math.max(0, ...totals), valueKind === "count");
  const W = 640;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, band * 0.5);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const af = axisFmt(valueKind);

  return (
    <ChartFrame
      title={title}
      description={description}
      legend={<Legend series={series} kind="rect" />}
      table={
        <DataTable
          caption={title}
          columns={["Période", ...series.map((s) => s.label), "Total"]}
          rows={data.map((d, i) => [d.label, ...series.map((s) => format(d.values[s.key] ?? 0)), format(totals[i])])}
        />
      }
    >
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t`}>
          <title id={`${id}-t`}>{title}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular">
                {af(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            let acc = 0;
            const segs = series.map((s) => {
              const v = d.values[s.key] ?? 0;
              const top = y(acc + v);
              const bottom = y(acc);
              acc += v;
              return { s, v, top, bottom };
            });
            const visible = segs.filter((g) => g.v > 0);
            return (
              <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label} : ${series.map((s) => `${s.label} ${format(d.values[s.key] ?? 0)}`).join(", ")}`}>
                <rect x={cx - band / 2} y={PAD.top} width={band} height={innerH} fill="transparent" />
                {visible.map((g, gi) => {
                  const isTop = gi === visible.length - 1;
                  const h = Math.max(0, g.bottom - g.top - (gi > 0 ? 2 : 0));
                  const r = isTop ? Math.min(4, h) : 0;
                  const x = cx - barW / 2;
                  const yTop = g.top;
                  const path = `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + h} Z`;
                  return <path key={g.s.key} d={path} fill={`var(--series-${g.s.color})`} opacity={hover === null || hover === i ? 1 : 0.55} />;
                })}
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                  {d.label}
                </text>
              </g>
            );
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: `clamp(0px, calc(${((PAD.left + band * hover + band / 2) / W) * 100}% - 5rem), calc(100% - 10rem))` }}
          >
            <p className="mb-1 font-medium">{data[hover].label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: `var(--series-${s.color})` }} />
                  {s.label}
                </span>
                <span className="font-semibold tabular">{format(data[hover].values[s.key] ?? 0)}</span>
              </p>
            ))}
            <p className="mt-1 flex justify-between gap-3 border-t pt-1">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold tabular">{format(totals[hover])}</span>
            </p>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

/** Courbes temporelles (ex. colis reçus / expédiés par jour) avec réticule. */
export function LineChart({
  title,
  description,
  data,
  series,
}: {
  title: string;
  description?: string;
  data: { x: string; label: string; values: Record<string, number> }[];
  series: Series[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const W = 640;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const { max, ticks } = niceTicks(Math.max(0, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0))), true);
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  return (
    <ChartFrame
      title={title}
      description={description}
      legend={<Legend series={series} kind="line" />}
      table={<DataTable caption={title} columns={["Jour", ...series.map((s) => s.label)]} rows={data.map((d) => [d.label, ...series.map((s) => d.values[s.key] ?? 0)])} />}
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-labelledby={`${id}-t`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(data.length - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? data.length) - 1));
          }}
          onBlur={() => setHover(null)}
        >
          <title id={`${id}-t`}>{title}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              <text key={d.x} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-muted-foreground text-[10px]">
                {d.label}
              </text>
            ) : null,
          )}
          {series.map((s) => (
            <polyline
              key={s.key}
              fill="none"
              stroke={`var(--series-${s.color})`}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={data.map((d, i) => `${x(i)},${y(d.values[s.key] ?? 0)}`).join(" ")}
            />
          ))}
          {series.map((s) => {
            const last = data.length - 1;
            if (last < 0) return null;
            return <circle key={s.key} cx={x(last)} cy={y(data[last].values[s.key] ?? 0)} r={4} fill={`var(--series-${s.color})`} stroke="var(--viz-surface)" strokeWidth={2} />;
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(data[hover].values[s.key] ?? 0)} r={4} fill={`var(--series-${s.color})`} stroke="var(--viz-surface)" strokeWidth={2} />
              ))}
            </g>
          )}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% - 4.5rem), calc(100% - 9rem))` }}
          >
            <p className="mb-1 font-medium">{data[hover].label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: `var(--series-${s.color})` }} />
                  {s.label}
                </span>
                <span className="font-semibold tabular">{data[hover].values[s.key] ?? 0}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

/** Barres horizontales, une seule série (valeur au bout de la barre). */
export function HorizontalBars({
  title,
  description,
  data,
  valueKind = "count",
}: {
  title: string;
  description?: string;
  data: { label: string; value: number; hint?: string }[];
  valueKind?: ValueKind;
}) {
  const format = fmt(valueKind);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ChartFrame
      title={title}
      description={description}
      table={<DataTable caption={title} columns={["Catégorie", "Valeur"]} rows={data.map((d) => [d.label, format(d.value)])} />}
    >
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Pas encore de données.</p>
      ) : (
        <ul className="space-y-3">
          {data.map((d) => (
            <li key={d.label} className="group grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-3" title={`${d.label} : ${format(d.value)}`}>
              <span className="truncate text-sm">
                {d.label}
                {d.hint && <span className="block text-xs text-muted-foreground">{d.hint}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-3 rounded-r-[4px] transition-opacity group-hover:opacity-80"
                  style={{ width: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 85)}%`, background: "var(--series-1)" }}
                  aria-hidden
                />
                <span className="text-sm font-medium tabular">{format(d.value)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}
