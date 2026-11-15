"use client";

import { createContext, use, useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import type { ActionState, FormAction } from "@/lib/action-types";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const FormStateContext = createContext<{ state: ActionState<unknown>; pending: boolean }>({ state: null, pending: false });

export function useFieldError(name: string): string | undefined {
  const { state } = use(FormStateContext);
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

export function useActionFormState() {
  return use(FormStateContext);
}

/**
 * Formulaire relié à une server action : état d'envoi, erreurs de champs,
 * notifications et redirection. Le bouton d'envoi est désactivé pendant le
 * traitement (protection contre le double clic).
 */
export function ActionForm<T = undefined>({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess = false,
  onSuccess,
  silent = false,
  id,
}: {
  action: FormAction<T>;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (state: Extract<ActionState<T>, { ok: true }>) => void;
  silent?: boolean;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (!silent) toast.success(state.message ?? successMessage ?? "Modifications enregistrées.");
      if (resetOnSuccess) formRef.current?.reset();
      onSuccessRef.current?.(state as Extract<ActionState<T>, { ok: true }>);
      if (state.redirectTo) {
        if (/^https?:\/\//.test(state.redirectTo)) window.location.assign(state.redirectTo);
        else router.push(state.redirectTo);
      }
    } else {
      toast.error(state.error);
    }
  }, [state, successMessage, resetOnSuccess, silent, router]);

  return (
    <FormStateContext value={{ state: state as ActionState<unknown>, pending }}>
      <form ref={formRef} action={formAction} className={className} id={id} noValidate={false}>
        {children}
      </form>
    </FormStateContext>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  className,
  variant,
  size,
  disabled,
  name,
  value,
  form,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  name?: string;
  value?: string;
  form?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className={cn(className)} variant={variant} size={size} disabled={pending || disabled} aria-busy={pending} name={name} value={value} form={form}>
      {pending && <Spinner className="size-4" />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

export function FormError() {
  const { state } = use(FormStateContext);
  if (!state || state.ok || state.fieldErrors?._ === undefined) return null;
  return <p className="text-sm text-destructive">{state.fieldErrors._}</p>;
}
