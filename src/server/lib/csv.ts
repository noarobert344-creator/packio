export type Cell = string | number | boolean | Date | null | undefined;

export const euro = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2).replace(".", ","));

/** Cellule CSV (séparateur « ; », compatible Excel) ; neutralise les formules (injection CSV). */
export function csvCell(v: Cell) {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "boolean" ? (v ? "oui" : "non") : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvResponse(filename: string, headers: string[], rows: Cell[][]) {
  const body = "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
