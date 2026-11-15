import type { Metadata } from "next";
import { CalendarOff, CircleCheck, Clock, MapPin } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { getAvailabilityData } from "@/server/queries/preparer";
import { DEFAULT_AVAILABILITY } from "@/server/services/preparers";
import { cancelAbsenceAction } from "@/server/actions/preparer";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { AbsenceDialog, AvailabilityForm, ProposeLocationDialog, type Availability } from "@/components/preparer/availability";
import { LOCATION_TYPE, PREPARER_STATUS, networkLabel } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { StepButton } from "@/components/preparer/step-form";

export const metadata: Metadata = { title: "Disponibilités" };

export default async function AvailabilityPage() {
  const actor = await requirePreparer();
  const { profile, absences, locations } = await getAvailabilityData(actor.preparerId);
  const availability = { ...DEFAULT_AVAILABILITY, ...((profile.availability as Partial<Availability> | null) ?? {}) } as Availability;
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disponibilités"
        description="Vos horaires, vos absences et vos points de réception."
        actions={<StatusFrom map={PREPARER_STATUS} value={profile.status} />}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Horaires hebdomadaires" description="Indiquez quand vous récupérez et préparez les colis.">
          <AvailabilityForm availability={availability} note={profile.availabilityNote} />
        </Section>

        <div className="space-y-6" id="absences">
          <Section title="Absences" description="Déclarez vos congés et indisponibilités." actions={<AbsenceDialog />} contentClassName="p-0">
            {absences.length ? (
              <ul className="divide-y">
                {absences.map((a) => {
                  const cancelled = !!a.cancelledAt;
                  const past = a.endsAt < now;
                  const current = !cancelled && a.startsAt <= now && a.endsAt >= now;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <CalendarOff className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          Du {formatDate(a.startsAt)} au {formatDate(a.endsAt)}
                        </p>
                        {a.reason && <p className="text-xs text-muted-foreground">{a.reason}</p>}
                      </div>
                      {cancelled ? (
                        <StatusBadge tone="neutral" label="Annulée" />
                      ) : past ? (
                        <StatusBadge tone="neutral" label="Terminée" />
                      ) : (
                        <>
                          <StatusBadge tone={current ? "warning" : "info"} label={current ? "En cours" : "Prévue"} />
                          <StepButton action={cancelAbsenceAction} fields={{ absenceId: a.id }} variant="ghost" size="sm" successMessage="Absence annulée.">
                            Annuler
                          </StepButton>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucune absence déclarée.</p>
            )}
          </Section>

          <Section
            title="Mes points de réception"
            description="Adresses communiquées à vos clients une fois validées par Packio."
            actions={<ProposeLocationDialog defaultRecipient={`${actor.firstName} ${actor.lastName}`} defaultCity={profile.city} />}
            contentClassName="p-0"
          >
            {locations.length ? (
              <ul className="divide-y">
                {locations.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-medium">
                        {l.label}
                        {l.isPrimary && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">Principal</span>}
                      </p>
                      <p className="text-muted-foreground">
                        {LOCATION_TYPE[l.type]}
                        {l.network && ` · ${networkLabel(l.network)}`}
                        {l.relayName && ` · ${l.relayName}`}
                      </p>
                      <p className="text-muted-foreground">
                        {l.addressLine1}, {l.postalCode} {l.city}
                      </p>
                    </div>
                    {!l.isActive ? (
                      <StatusBadge tone="neutral" label="Désactivé" />
                    ) : l.validatedAt ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <CircleCheck className="size-3.5" /> Validé
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                        <Clock className="size-3.5" /> En attente de validation
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun point de réception. Proposez-en un pour recevoir les commandes de vos clients.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
