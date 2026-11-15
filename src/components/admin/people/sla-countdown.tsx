"use client";

import { useEffect, useState } from "react";
import { Clock, TriangleAlert } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Compte à rebours de l'échéance d'attribution (rafraîchi toutes les 30 s). */
export function SlaCountdown({ dueAt, requestedAt, compact = false }: { dueAt: string | null; requestedAt: string | null; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!dueAt) return <span className="text-xs text-muted-foreground">—</span>;
  const remaining = Math.round((new Date(dueAt).getTime() - now) / 60000);
  const elapsed = requestedAt ? Math.round((now - new Date(requestedAt).getTime()) / 60000) : null;
  const late = remaining <= 0;
  const soon = !late && remaining <= 120;
  return (
    <span className={cn("inline-flex flex-col gap-0.5", compact && "flex-row items-center gap-2")}>
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium tabular", late ? "text-danger" : soon ? "text-warning" : "text-foreground")}>
        {late ? <TriangleAlert className="size-3.5" /> : <Clock className="size-3.5" />}
        {late ? `Retard de ${formatDuration(-remaining)}` : `${formatDuration(remaining)} restantes`}
      </span>
      {elapsed !== null && !compact && <span className="text-[0.7rem] text-muted-foreground tabular">Attente : {formatDuration(elapsed)}</span>}
    </span>
  );
}
