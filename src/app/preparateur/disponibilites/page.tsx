import type { Metadata } from "next";
import { db } from "@/server/db";
import { CalendarOff } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { getAvailabilityData } from "@/server/queries/preparer";
import { DEFAULT_AVAILABILITY } from "@/server/services/preparers";
import { cancelAbsenceAction } from "@/server/actions/preparer";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { AbsenceDialog, AvailabilityForm, type Availability } from "@/components/preparer/availability";
import { PreparerLocationsSection } from "@/components/preparer/locations-section";
import { PREPARER_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { StepButton } from "@/components/preparer/step-form";

export const metadata: Metadata = { title: "Disponibilités" };

export default async function AvailabilityPage() {
  const actor = await requirePreparer();
  const [{ profile, absences, locations }, me] = await Promise.all([
    getAvailabilityData(actor.preparerId),
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { phone: true } }),
  ]);
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

          <PreparerLocationsSection locations={locations} defaultRecipient={`${actor.firstName} ${actor.lastName}`} defaultCity={profile.city} defaultPhone={me.phone} />
        </div>
      </div>
    </div>
  );
}
