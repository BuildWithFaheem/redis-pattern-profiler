import Table from "cli-table3";
import { ProfileResult } from "./profiler";

export interface ReportOptions {
  top?: number;
  sort?: "bytes" | "count";
  json?: boolean;
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)}GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)}MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)}KB`;
  return `${n}B`;
}

export function report(result: ProfileResult, opts: ReportOptions = {}): void {
  const { top = 20, sort = "bytes", json = false } = opts;

  const rows = [...result.entries()]
    .sort((a, b) =>
      sort === "count"
        ? b[1].count - a[1].count
        : b[1].totalBytes - a[1].totalBytes
    )
    .slice(0, top);

  if (json) {
    const out = rows.map(([pattern, s]) => ({
      pattern,
      totalBytes: s.totalBytes,
      count: s.count,
      ttlPct: s.count > 0 ? +((s.keysWithTTL / s.count) * 100).toFixed(1) : 0,
    }));
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  const table = new Table({
    head: ["Pattern", "Total Size", "Keys", "TTL%"],
    style: { head: ["cyan"] },
  });

  for (const [pattern, s] of rows) {
    const ttlPct = s.count > 0 ? ((s.keysWithTTL / s.count) * 100).toFixed(0) : "0";
    table.push([pattern, fmtBytes(s.totalBytes), String(s.count), `${ttlPct}%`]);
  }

  process.stdout.write(table.toString() + "\n");
}
