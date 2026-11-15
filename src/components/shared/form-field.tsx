"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useFieldError } from "./action-form";

type BaseProps = { name: string; label: React.ReactNode; hint?: React.ReactNode; className?: string; required?: boolean };

export function FieldShell({ name, label, hint, className, required, children, id }: BaseProps & { children: React.ReactNode; id: string }) {
  const error = useFieldError(name);
  return (
    <div className={cn("grid gap-1.5", className)} data-invalid={!!error || undefined}>
      <Label htmlFor={id} className="text-[0.8rem] font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  name,
  label,
  hint,
  className,
  required,
  ...props
}: BaseProps & Omit<React.ComponentProps<typeof Input>, "name">) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <FieldShell name={name} label={label} hint={hint} className={className} required={required} id={id}>
      <Input id={id} name={name} required={required} aria-invalid={!!error || undefined} className="h-10" {...props} />
    </FieldShell>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  className,
  required,
  ...props
}: BaseProps & Omit<React.ComponentProps<typeof Textarea>, "name">) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <FieldShell name={name} label={label} hint={hint} className={className} required={required} id={id}>
      <Textarea id={id} name={name} required={required} aria-invalid={!!error || undefined} {...props} />
    </FieldShell>
  );
}

/** Liste déroulante native (fiable sur mobile, compatible FormData). */
export function SelectField({
  name,
  label,
  hint,
  className,
  required,
  options,
  placeholder,
  ...props
}: BaseProps & Omit<React.ComponentProps<"select">, "name"> & { options: { value: string; label: string; disabled?: boolean }[]; placeholder?: string }) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <FieldShell name={name} label={label} hint={hint} className={className} required={required} id={id}>
      <select
        id={id}
        name={name}
        required={required}
        aria-invalid={!!error || undefined}
        className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50 dark:bg-input/30"
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({ name, label, hint, defaultChecked, className, required }: BaseProps & { defaultChecked?: boolean }) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <div className={cn("grid gap-1", className)}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          id={id}
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          required={required}
          className="mt-0.5 size-4 shrink-0 rounded border-input accent-[var(--brand)]"
        />
        <span className="leading-snug">{label}</span>
      </label>
      {error ? <p className="pl-6.5 text-xs text-destructive">{error}</p> : hint ? <p className="pl-6.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Jeton d'idempotence généré à l'affichage du formulaire (anti double soumission). */
export function RequestIdInput({ value }: { value: string }) {
  return <input type="hidden" name="requestId" value={value} />;
}
