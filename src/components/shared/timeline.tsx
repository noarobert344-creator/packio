import { formatDateTime } from "@/lib/format";
import type { Tone } from "@/lib/labels";
import { cn } from "@/lib/utils";

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  brand: "bg-brand",
};

export type TimelineEntry = {
  id: string;
  label: string;
  tone: Tone;
  at: Date;
  actor?: string | null;
  note?: string | null;
};

export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">Aucun événement.</p>;
  return (
    <ol className={cn("relative space-y-5", className)}>
      {entries.map((e, i) => (
        <li key={e.id} className="relative flex gap-3.5 pl-0.5">
          {i < entries.length - 1 && <span className="absolute top-4 left-[5px] h-[calc(100%+0.5rem)] w-px bg-border" aria-hidden />}
          <span className={cn("relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-card", DOT[e.tone])} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-sm font-medium">{e.label}</p>
              <time className="text-xs text-muted-foreground tabular">{formatDateTime(e.at)}</time>
            </div>
            {e.actor && <p className="text-xs text-muted-foreground">par {e.actor}</p>}
            {e.note && <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{e.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Progression horizontale par étapes (suivi d'une commande ou expédition). */
export function StepProgress({ steps, current, failed }: { steps: { key: string; label: string }[]; current: string; failed?: boolean }) {
  const index = steps.findIndex((s) => s.key === current);
  return (
    <ol className="flex w-full items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none" aria-label="Progression">
      {steps.map((s, i) => {
        const done = index >= 0 && i < index;
        const active = i === index;
        return (
          <li key={s.key} className="flex min-w-[5.5rem] flex-1 flex-col gap-1.5">
            <span
              className={cn(
                "h-1.5 rounded-full transition-colors",
                done ? "bg-brand" : active ? (failed ? "bg-danger" : "bg-brand/70") : "bg-muted",
              )}
            />
            <span className={cn("text-[0.7rem] leading-tight", active ? "font-medium text-foreground" : "text-muted-foreground")}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
