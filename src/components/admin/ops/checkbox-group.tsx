import { cn } from "@/lib/utils";

/** Groupe de cases à cocher natif (valeurs multiples `name[]`, compatible FormData). */
export function CheckboxGroup({
  name,
  label,
  options,
  selected,
  disabled,
  columns = 2,
}: {
  name: string;
  label: string;
  options: { value: string; label: string; hint?: string }[];
  selected: readonly string[];
  disabled?: boolean;
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-1 text-[0.8rem] font-medium">{label}</legend>
      <div className={cn("grid gap-x-4 gap-y-2", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-2 lg:grid-cols-3")}>
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" name={`${name}[]`} value={o.value} defaultChecked={selected.includes(o.value)} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
            <span className="leading-snug">
              {o.label}
              {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
