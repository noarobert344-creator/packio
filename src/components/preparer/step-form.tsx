"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ActionState, FormAction } from "@/lib/action-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";

/**
 * Les formulaires d'étape disparaissent dès que le statut change (le serveur
 * renvoie le nouveau panneau dans la même réponse) : la notification de succès
 * est donc émise directement à la résolution de l'action, et non dans un effet
 * du formulaire, qui serait démonté avant de s'exécuter.
 */
function useNotifyingAction(action: FormAction, fallback: string) {
  return useCallback(
    async (prev: ActionState, formData: FormData) => {
      const res = await action(prev, formData);
      if (res?.ok) toast.success(res.message ?? fallback);
      return res;
    },
    [action, fallback],
  );
}

export function StepForm({
  action,
  children,
  className,
  successMessage = "Enregistré.",
  onSuccess,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
  onSuccess?: () => void;
}) {
  const wrapped = useNotifyingAction(action, successMessage);
  return (
    <ActionForm action={wrapped} silent className={className} onSuccess={onSuccess}>
      {children}
    </ActionForm>
  );
}

export function StepButton({
  action,
  fields,
  children,
  variant,
  size,
  className,
  successMessage,
}: {
  action: FormAction;
  fields: Record<string, string>;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  successMessage?: string;
}) {
  return (
    <StepForm action={action} successMessage={successMessage} className="flex">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} size={size} className={className}>
        {children}
      </SubmitButton>
    </StepForm>
  );
}

export function StepDialog({
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
  action: FormAction;
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
        <StepForm action={action} successMessage={successMessage} onSuccess={() => setOpen(false)} className="grid gap-4">
          {children}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <SubmitButton variant={destructive ? "destructive" : "default"} pendingLabel={pendingLabel}>
              {submitLabel}
            </SubmitButton>
          </DialogFooter>
        </StepForm>
      </DialogContent>
    </Dialog>
  );
}
