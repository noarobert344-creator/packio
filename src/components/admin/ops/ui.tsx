import Link from "next/link";
import { Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ExportLink({ entity, label = "Exporter (CSV)", params }: { entity: string; label?: string; params?: Record<string, string | undefined> }) {
  const sp = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]);
  return (
    <Button asChild variant="outline" size="sm">
      <a href={`/api/admin/export/${entity}${sp.size ? `?${sp}` : ""}`} download>
        <Download /> {label}
      </a>
    </Button>
  );
}

/** Liste de définitions (libellé / valeur). */
export function InfoList({ items, className }: { items: { label: string; value: React.ReactNode; hidden?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2", className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{i.label}</dt>
            <dd className="mt-0.5 break-words">{i.value ?? "—"}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Notice({ children, tone = "info", className }: { children: React.ReactNode; tone?: "info" | "warning"; className?: string }) {
  return (
    <div className={cn("flex gap-2.5 rounded-xl px-3.5 py-3 text-sm", tone === "warning" ? "bg-warning-soft text-warning" : "bg-info-soft text-info", className)}>
      <Info className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 [&_a]:underline">{children}</div>
    </div>
  );
}

export function CustomerLink({ customer }: { customer: { id: string; referenceCode: string; user: { firstName: string; lastName: string } } | null }) {
  if (!customer) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={`/admin/clients/${customer.id}`} className="group block min-w-0">
      <span className="block truncate font-medium group-hover:underline">
        {customer.user.firstName} {customer.user.lastName}
      </span>
      <span className="block text-xs text-muted-foreground">{customer.referenceCode}</span>
    </Link>
  );
}

export function PreparerLink({ preparer }: { preparer: { id: string; user: { firstName: string; lastName: string } } | null }) {
  if (!preparer) return <span className="text-muted-foreground">—</span>;
  return (
    <Link href={`/admin/preparateurs/${preparer.id}`} className="truncate hover:underline">
      {preparer.user.firstName} {preparer.user.lastName}
    </Link>
  );
}

/** Jauge d'utilisation (capacité de stockage, capacité clients). */
export function UsageMeter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? value / max : 0;
  const tone = ratio >= 0.95 ? "bg-danger" : ratio >= 0.8 ? "bg-warning" : "bg-brand";
  return (
    <div className="space-y-1" title={`${label} : ${value} / ${max}`}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-soft">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <p className="text-xs text-muted-foreground tabular">
        {value} / {max} · {Math.round(ratio * 100)} %
      </p>
    </div>
  );
}

