"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatCurrency, formatNumber } from "@/lib/utils";

/**
 * Brand chart rules: max two series (lime + ink), one y-axis, thin marks,
 * recessive grid, tooltip on hover, legend whenever there are 2 series.
 */
export type Series = { key: string; label: string; color?: "lime" | "ink" | "grey" };

const COLOR = { lime: "var(--chart-1)", ink: "var(--chart-2)", grey: "var(--chart-4)" } as const;
const axisProps = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

type ValueKind = "number" | "currency";
const fmt = (kind: ValueKind, currency = "INR", compact = false) => (v: unknown) =>
  kind === "currency" ? formatCurrency(v, currency, { compact }) : formatNumber(v, { compact });

const dateTick = (v: string) => {
  try {
    return format(parseISO(v), "d MMM");
  } catch {
    return v;
  }
};

function ChartTooltip({ kind, currency }: { kind: ValueKind; currency?: string }) {
  return (
    <Tooltip
      cursor={{ stroke: "var(--border)", strokeWidth: 1, fill: "var(--muted)", fillOpacity: 0.5 }}
      contentStyle={{
        background: "var(--popover)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        fontSize: 12,
        color: "var(--popover-foreground)",
        boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
      }}
      labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
      itemStyle={{ color: "var(--popover-foreground)", padding: 0 }}
      formatter={(value) => fmt(kind, currency)(value)}
      labelFormatter={(label) => (typeof label === "string" && /^\d{4}-\d{2}-\d{2}/.test(label) ? dateTick(label) : String(label))}
    />
  );
}

export function TrendChart({
  data, xKey = "date", series, kind = "number", currency, height = 240,
}: { data: Record<string, unknown>[]; xKey?: string; series: Series[]; kind?: ValueKind; currency?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR[s.color ?? "lime"]} stopOpacity={0.25} />
              <stop offset="100%" stopColor={COLOR[s.color ?? "lime"]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={dateTick} minTickGap={24} />
        <YAxis {...axisProps} width={56} allowDecimals={false} tickFormatter={fmt(kind, currency, true)} />
        <ChartTooltip kind={kind} currency={currency} />
        {series.length > 1 ? <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} /> : null}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={COLOR[s.color ?? "lime"]}
            strokeWidth={2}
            fill={`url(#fill-${s.key})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarsChart({
  data, xKey, series, kind = "number", currency, height = 260, layout = "vertical-bars",
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  kind?: ValueKind;
  currency?: string;
  height?: number;
  /** "vertical-bars" = categories on X; "horizontal-bars" = categories on Y (long labels). */
  layout?: "vertical-bars" | "horizontal-bars";
}) {
  const horizontal = layout === "horizontal-bars";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--chart-grid)" />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={fmt(kind, currency, true)} />
            <YAxis type="category" dataKey={xKey} {...axisProps} width={120} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} interval={0} tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)} />
            <YAxis {...axisProps} width={56} allowDecimals={false} tickFormatter={fmt(kind, currency, true)} />
          </>
        )}
        <ChartTooltip kind={kind} currency={currency} />
        {series.length > 1 ? <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} /> : null}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={COLOR[s.color ?? "lime"]}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={28}
            stroke="var(--card)"
            strokeWidth={1}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Wraps a chart with its title, an empty state and a screen-reader data summary. */
export function ChartPanel({
  title, description, empty, emptyText = "No data for the selected period.", children, footer,
}: { title: string; description?: string; empty?: boolean; emptyText?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-lg border bg-card">
      <header className="space-y-0.5 px-5 pt-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </header>
      <div className="flex-1 px-3 pb-3 pt-2">
        {empty ? <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{emptyText}</div> : children}
      </div>
      {footer ? <footer className="border-t px-5 py-3 text-xs text-muted-foreground">{footer}</footer> : null}
    </section>
  );
}
