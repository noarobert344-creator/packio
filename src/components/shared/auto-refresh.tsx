"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Rafraîchit la page (données serveur) à intervalle régulier, un nombre limité de fois. */
export function AutoRefresh({ everyMs = 3000, maxTries = 10 }: { everyMs?: number; maxTries?: number }) {
  const router = useRouter();
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > maxTries) return clearInterval(timer);
      router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, maxTries]);
  return null;
}
