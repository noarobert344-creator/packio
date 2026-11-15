import { cn } from "@/lib/utils";

/**
 * Logo PACKIO : un « P » dont la boucle évoque un colis scellé, et un point
 * carré figurant le colis livré. Tracé en SVG, adapté au thème.
 */
export function LogoMark({ className, title = "Packio" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={title} className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="8.5" className="fill-brand" />
      <path
        d="M10.5 24.5V7.5h8.25a4.75 4.75 0 0 1 0 9.5H10.5"
        fill="none"
        stroke="white"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.75 7.5v9.5" stroke="white" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="18.6" y="20.4" width="4.6" height="4.6" rx="1.3" fill="white" />
    </svg>
  );
}

export function Logo({ className, markClassName, wordmark = true }: { className?: string; markClassName?: string; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      {wordmark && <span className="text-[0.95rem] font-bold tracking-[0.16em] text-foreground">PACKIO</span>}
    </span>
  );
}
