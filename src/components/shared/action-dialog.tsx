"use client";

import { useState } from "react";
import type { FormAction } from "@/lib/action-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "./action-form";

/**
 * Boîte de dialogue contenant un formulaire relié à une server action.
 * Se ferme automatiquement en cas de succès.
 */
export function ActionDialog<T = undefined>({
  trigger,
  title,
  description,
  action,
  children,
  submitLabel = "Confirmer",
  pendingLabel,
  destructive,
  successMessage,
  wide,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action: FormAction<T>;
  children?: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  destructive?: boolean;
  successMessage?: string;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={wide ? "sm:max-w-2xl" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <ActionForm action={action} successMessage={successMessage} onSuccess={() => setOpen(false)} className="grid gap-4">
          {children}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton variant={destructive ? "destructive" : "default"} pendingLabel={pendingLabel}>
              {submitLabel}
            </SubmitButton>
          </DialogFooter>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** Bouton déclenchant directement une action (formulaire caché avec champs). */
export function ActionButton<T = undefined>({
  action,
  fields,
  children,
  variant,
  size,
  className,
  successMessage,
}: {
  action: FormAction<T>;
  fields?: Record<string, string>;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  successMessage?: string;
}) {
  return (
    <ActionForm action={action} successMessage={successMessage} className="inline-flex">
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} size={size} className={className}>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}
