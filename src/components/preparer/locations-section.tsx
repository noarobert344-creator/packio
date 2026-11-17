import { CircleCheck, Clock, Mail, MapPin } from "lucide-react";
import { Section } from "@/components/shared/page-header";
import { LOCATION_TYPE, networkLabel } from "@/lib/labels";
import { LocationDialog, RemoveLocationButton, SetPrimaryButton, type PreparerLocationValues } from "./locations";

type Location = Omit<PreparerLocationValues, "validated"> & {
  isPrimary: boolean;
  isActive: boolean;
  validatedAt: Date | null;
};

/** Points de réception du préparateur, modifiables (Paramètres et Disponibilités). */
export function PreparerLocationsSection({
  locations,
  defaultRecipient,
  defaultCity,
  defaultPhone,
}: {
  locations: Location[];
  defaultRecipient: string;
  defaultCity: string;
  defaultPhone: string | null;
}) {
  const active = locations.filter((l) => l.isActive);
  const defaults = { defaultRecipient, defaultCity, defaultPhone };
  return (
    <Section
      title="Mes points de réception"
      description="Lockers, points relais et poste restante où vos clients font livrer leurs achats. Votre adresse, si vous l'ajoutez, sert quand le fournisseur ne livre pas en point relais. Communiqués aux clients une fois validés par Packio."
      actions={<LocationDialog {...defaults} />}
      contentClassName="p-0"
    >
      {active.length ? (
        <ul className="divide-y">
          {active.map((l) => {
            const Icon = l.type === "POST_OFFICE" ? Mail : MapPin;
            return (
              <li key={l.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                <Icon className="mt-0.5 size-4 shrink-0 text-brand" />
                <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                  <p className="font-medium">
                    {l.label}
                    {l.isPrimary && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">Principal</span>}
                  </p>
                  <p className="text-muted-foreground">
                    {LOCATION_TYPE[l.type]}
                    {l.network && l.type !== "POST_OFFICE" && ` · ${networkLabel(l.network)}`}
                    {l.relayName && ` · ${l.relayName}`}
                  </p>
                  <p className="text-muted-foreground">
                    {l.addressLine1}, {l.postalCode} {l.city}
                  </p>
                  <p className="text-muted-foreground">
                    Destinataire : {l.recipientName}
                    {l.recipientPhone && ` · ${l.recipientPhone}`}
                  </p>
                  {l.validatedAt ? (
                    <p className="inline-flex items-center gap-1 pt-1 text-xs font-medium text-success">
                      <CircleCheck className="size-3.5" /> Validé : proposé à vos clients
                    </p>
                  ) : (
                    <p className="inline-flex items-center gap-1 pt-1 text-xs font-medium text-warning">
                      <Clock className="size-3.5" /> En attente de validation par Packio
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <LocationDialog location={{ ...l, validated: !!l.validatedAt }} {...defaults} />
                  {!l.isPrimary && <SetPrimaryButton locationId={l.id} />}
                  {active.length > 1 && <RemoveLocationButton locationId={l.id} label={l.label} />}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun point de réception. Ajoutez-en un pour recevoir les commandes de vos clients.</p>
      )}
    </Section>
  );
}
