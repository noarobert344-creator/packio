"use client";

import { createContext, use, useActionState, useEffect, useMemo, useRef } from "react";
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
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const optionsRef = useRef({ onSuccess, successMessage, resetOnSuccess, silent });
  useEffect(() => {
    optionsRef.current = { onSuccess, successMessage, resetOnSuccess, silent };
  });

  // Le résultat est traité dès le retour de l'action (et non dans un effet) :
  // le message s'affiche même si le formulaire disparaît après le
  // rafraîchissement de la page (ex. bouton d'étape remplacé par le suivant).
  const handled = useMemo(() => {
    const guarded = withNetworkGuard(action);
    return async (prev: ActionState<T>, formData: FormData): Promise<ActionState<T>> => {
      const result = await guarded(prev, formData);
      const opts = optionsRef.current;
      if (result?.ok) {
        if (!opts.silent) toast.success(result.message ?? opts.successMessage ?? "Modifications enregistrées.");
        if (opts.resetOnSuccess) formRef.current?.reset();
        opts.onSuccess?.(result as Extract<ActionState<T>, { ok: true }>);
        if (result.redirectTo) {
          if (/^https?:\/\//.test(result.redirectTo)) window.location.assign(result.redirectTo);
          else router.push(result.redirectTo);
        }
      } else if (result) {
        toast.error(result.error);
      }
      return result;
    };
  }, [action, router]);

  const [state, formAction, pending] = useActionState(handled, null);

  return (
    <FormStateContext value={{ state: state as ActionState<unknown>, pending }}>
      <form ref={formRef} action={formAction} className={className} id={id} noValidate={false}>
        {children}
      </form>
    </FormStateContext>
  );
}

const NETWORK_ERROR = "Connexion au serveur impossible. Vérifiez votre connexion internet puis réessayez.";

/**
 * Transforme une erreur réseau (hors ligne, coupure, délai dépassé) en message
 * d'erreur affichable. Les redirections et erreurs de navigation de Next sont
 * relancées telles quelles.
 */
function withNetworkGuard<T>(action: FormAction<T>): FormAction<T> {
  return async (prev, formData) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { ok: false, error: "Vous semblez hors ligne. Vos informations n'ont pas été envoyées." };
    }
    try {
      return await action(prev, formData);
    } catch (err) {
      const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest?: unknown }).digest) : "";
      if (digest.startsWith("NEXT_")) throw err;
      return { ok: false, error: NETWORK_ERROR };
    }
  };
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
