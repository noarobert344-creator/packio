"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SpaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <TriangleAlert className="size-6" />
      </span>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Cette page n&apos;a pas pu être chargée</h1>
        <p className="text-sm text-muted-foreground">Vérifiez votre connexion internet puis réessayez. Si le problème persiste, contactez le support Packio.</p>
        {error.digest && <p className="text-xs text-muted-foreground/70">Référence : {error.digest}</p>}
      </div>
      <Button onClick={reset}>
        <RefreshCw /> Réessayer
      </Button>
    </div>
  );
}
