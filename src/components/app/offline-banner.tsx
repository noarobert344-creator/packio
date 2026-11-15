"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Bandeau affiché lorsque le navigateur perd la connexion réseau. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-xs font-medium text-white">
      <WifiOff className="size-3.5" /> Connexion perdue : les actions seront possibles dès le retour du réseau.
    </div>
  );
}
