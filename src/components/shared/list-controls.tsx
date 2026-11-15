"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  return { set, params, pending };
}

export function SearchInput({ placeholder = "Rechercher…", param = "q", className }: { placeholder?: string; param?: string; className?: string }) {
  const { set, params, pending } = useParamSetter();
  const [value, setValue] = useState(params.get(param) ?? "");
  useEffect(() => {
    const current = params.get(param) ?? "";
    if (value === current) return;
    const t = setTimeout(() => set({ [param]: value }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search className={cn("pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground", pending && "animate-pulse")} />
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="h-9 pl-9" type="search" aria-label={placeholder} />
    </div>
  );
}

export function FilterSelect({ param, options, placeholder = "Tous", className }: { param: string; options: { value: string; label: string }[]; placeholder?: string; className?: string }) {
  const { set, params } = useParamSetter();
  return (
    <select
      value={params.get(param) ?? ""}
      onChange={(e) => set({ [param]: e.target.value || null })}
      className={cn("h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30", className)}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FilterTabs({ param, options }: { param: string; options: { value: string; label: string; count?: number }[] }) {
  const { set, params } = useParamSetter();
  const current = params.get(param) ?? "";
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 scrollbar-none">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => set({ [param]: o.value || null })}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
            current === o.value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="rounded-full bg-muted-foreground/10 px-1.5 text-xs tabular">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    if (p > 1) sp.set("page", String(p));
    else sp.delete("page");
    return `${basePath}${sp.size ? `?${sp}` : ""}`;
  };
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-muted-foreground">
      <span className="tabular">
        Page {page} sur {pages} · {total} résultat{total > 1 ? "s" : ""}
      </span>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm" aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
          <Link href={href(page - 1)}>
            <ChevronLeft /> Précédent
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" aria-disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-50" : ""}>
          <Link href={href(page + 1)}>
            Suivant <ChevronRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}
