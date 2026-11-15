"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFieldError } from "@/components/shared/action-form";
import { CapacityBar } from "./capacity-bar";
import type { CapacityOption } from "./types";

/** Liste de préparateurs sélectionnables avec leur capacité. */
export function PreparerPicker({ options, excludeId, name = "preparerId" }: { options: CapacityOption[]; excludeId?: string | null; name?: string }) {
  const list = options.filter((o) => o.id !== excludeId);
  const firstAvailable = list.find((o) => o.available)?.id ?? "";
  const [selected, setSelected] = useState(firstAvailable);
  const error = useFieldError(name);
  if (!list.length) return <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Aucun préparateur enregistré.</p>;
  return (
    <div className="grid gap-2">
      <input type="hidden" name={name} value={selected} />
      <div className="grid max-h-[22rem] gap-2 overflow-y-auto pr-1" role="radiogroup" aria-label="Préparateur">
        {list.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected === o.id}
            disabled={!o.available}
            onClick={() => setSelected(o.id)}
            className={cn(
              "grid gap-3 rounded-xl border p-3.5 text-left transition-colors sm:grid-cols-[1fr_9rem_9rem] sm:items-center",
              selected === o.id ? "border-brand bg-brand-soft/50 ring-1 ring-brand" : "hover:border-foreground/20",
              !o.available && "cursor-not-allowed opacity-60",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{o.name}</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" /> {o.city} · {o.validatedLocations} point(s) validé(s)
              </p>
              {!o.available && <p className="mt-1 text-xs font-medium text-danger">{o.unavailableReason}</p>}
            </div>
            <CapacityBar label="Clients" value={o.activeClients} max={o.maxClients} />
            <CapacityBar label="Stock (articles)" value={o.storedUnits} max={o.storageCapacity} />
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
