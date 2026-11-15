"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FieldShell } from "@/components/shared/form-field";
import { useFieldError } from "@/components/shared/action-form";

export function PasswordField({ name, label, hint, autoComplete = "current-password", required = true }: { name: string; label: string; hint?: string; autoComplete?: string; required?: boolean }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const error = useFieldError(name);
  return (
    <FieldShell name={name} label={label} hint={hint} id={id} required={required}>
      <div className="relative">
        <Input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} required={required} aria-invalid={!!error || undefined} className="h-10 pr-10" />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </FieldShell>
  );
}
