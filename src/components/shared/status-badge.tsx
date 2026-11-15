import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/labels";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  info: "bg-info-soft text-info ring-info/20",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-warning ring-warning/25",
  danger: "bg-danger-soft text-danger ring-danger/20",
  brand: "bg-brand-soft text-brand ring-brand/20",
};

export function StatusBadge({ tone, label, className, dot = true }: { tone: Tone; label: string; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {label}
    </span>
  );
}

export function StatusFrom<T extends string>({ map, value, className }: { map: Record<T, { label: string; tone: Tone }>; value: T; className?: string }) {
  const entry = map[value];
  return <StatusBadge tone={entry.tone} label={entry.label} className={className} />;
}
