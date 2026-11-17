import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, CircleAlert, Lock, MapPin, Package, PackageCheck, Truck, Users } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { getPreparerDetail, getPreparerOperations, listWaitingCustomers } from "@/server/queries/admin-people";
import { computeSla, listPreparerCapacities } from "@/server/services/assignments";
import { getPreparerStats, type WeeklyAvailability } from "@/server/services/preparers";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DemoBadge, KeyValue } from "@/components/admin/people/display";
import { CapacityBar } from "@/components/admin/people/capacity-bar";
import { EditPreparerDialog, MessagePreparerDialog, ParcelsProcessedDialog, PreparerStatusDialog, ResendInvitationButton } from "@/components/admin/people/preparer-forms";
import { LocationDialog } from "@/components/admin/people/location-dialog";
import { ActionButton } from "@/components/shared/action-dialog";
import { clearPreparerAddressAction } from "@/server/actions/admin/people";
import { AbsenceDialog } from "@/components/admin/people/misc-actions";
import { AssignCustomerDialog, CancelAbsenceButton, DeactivateLocationButton, LocationValidationButton } from "@/components/admin/people/preparer-actions";
import { LOCATION_TYPE, PREPARER_STATUS, SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS, carrierLabel, networkLabel } from "@/lib/labels";
import { formatDate, formatDateTime, fullName, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Fiche préparateur — Administration" };

const DAYS: { key: keyof WeeklyAvailability; label: string }[] = [
  { key: "mon", label: "Lundi" },
  { key: "tue", label: "Mardi" },
  { key: "wed", label: "Mercredi" },
  { key: "thu", label: "Jeudi" },
  { key: "fri", label: "Vendredi" },
  { key: "sat", label: "Samedi" },
  { key: "sun", label: "Dimanche" },
];

export default async function AdminPreparerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin("preparers.read");
  const { id } = await params;
  const preparer = await getPreparerDetail(id);
  if (!preparer) notFound();
  const canManage = can(actor, "preparers.manage");
  const canAssign = can(actor, "assignments.manage");
  const [stats, ops, capacities, waiting] = await Promise.all([
    getPreparerStats(id),
    getPreparerOperations(id),
    listPreparerCapacities(),
    canAssign ? listWaitingCustomers() : Promise.resolve([]),
  ]);
  const capacity = capacities.find((c) => c.id === id);
  const name = fullName(preparer.user);
  const availability = (preparer.availability ?? null) as WeeklyAvailability | null;
  const now = new Date();
  const assignable = waiting
    .filter((c) => !c.currentPreparerId)
    .map((c) => ({ id: c.id, name: fullName(c.user), code: c.referenceCode, late: computeSla(c).isLate }));
  const activeLocations = preparer.locations.filter((l) => l.isActive);
  const inactiveLocations = preparer.locations.filter((l) => !l.isActive);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin/preparateurs", label: "Préparateurs" }}
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <Avatar className="size-11">
              {preparer.user.avatarFileId && <AvatarImage src={`/api/files/${preparer.user.avatarFileId}`} alt="" />}
              <AvatarFallback className="bg-brand-soft text-sm font-semibold text-brand">{initials(preparer.user.firstName, preparer.user.lastName)}</AvatarFallback>
            </Avatar>
            {name}
            <DemoBadge show={preparer.user.isDemo} />
          </span>
        }
        description={`${preparer.city} (${preparer.country}) · inscrit le ${formatDate(preparer.joinedAt)}`}
        actions={
          <>
            <StatusFrom map={PREPARER_STATUS} value={preparer.status} />
            {preparer.user.status !== "ACTIVE" && <StatusBadge tone="danger" label="Accès bloqué" />}
            {canManage && (
              <EditPreparerDialog
                preparerId={preparer.id}
                values={{
                  firstName: preparer.user.firstName,
                  lastName: preparer.user.lastName,
                  email: preparer.user.email,
                  phone: preparer.user.phone,
                  city: preparer.city,
                  country: preparer.country,
                  compatibleCarriers: preparer.compatibleCarriers,
                  storageCapacity: preparer.storageCapacity,
                  maxClients: preparer.maxClients,
                  availabilityNote: preparer.availabilityNote,
                  adminNotes: preparer.adminNotes,
                }}
              />
            )}
            {canManage && <PreparerStatusDialog preparerId={preparer.id} status={preparer.status} clients={stats.clients} />}
            {canManage && <ParcelsProcessedDialog preparerId={preparer.id} name={name} value={preparer.parcelsProcessed} />}
            {can(actor, "support.manage") && <MessagePreparerDialog preparerId={preparer.id} name={name} />}
          </>
        }
      />

      {!preparer.user.passwordHash && canManage && (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-warning">Ce préparateur n&apos;a pas encore activé son compte.</p>
          <ResendInvitationButton preparerId={preparer.id} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Clients actifs" value={`${stats.clients}/${preparer.maxClients}`} icon={Users} tone="brand" />
        <StatCard label="Colis traités" value={preparer.parcelsProcessed} icon={PackageCheck} />
        <StatCard label="Commandes mises en stock" value={stats.receivedOrders} icon={Package} />
        <StatCard label="Expéditions (30 j)" value={stats.shippedLast30Days} icon={Truck} />
        <StatCard label="Articles stockés" value={`${stats.storedUnits}/${preparer.storageCapacity}`} icon={Boxes} />
        <StatCard label="Incidents ouverts" value={stats.openIncidents} icon={CircleAlert} tone={stats.openIncidents ? "danger" : "default"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <Section
            title="Lieux de réception"
            description="Adresse professionnelle, locker principal et lockers secondaires. Seuls les lieux validés sont communiqués aux clients."
            actions={canManage ? <LocationDialog preparerId={preparer.id} defaultRecipient={name} defaultPhone={preparer.user.phone} /> : null}
          >
            {activeLocations.length === 0 ? (
              <EmptyState icon={MapPin} title="Aucun lieu de réception" description="Ajoutez et validez au moins un lieu pour pouvoir attribuer des clients à ce préparateur." />
            ) : (
              <ul className="grid gap-3">
                {activeLocations.map((l) => (
                  <li key={l.id} className={cn("rounded-xl border p-4", l.isPrimary && "border-brand/40")}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{l.label}</p>
                          <StatusBadge tone="neutral" label={LOCATION_TYPE[l.type]} dot={false} />
                          {l.isPrimary && <StatusBadge tone="brand" label="Principal" dot={false} />}
                          {l.validatedAt ? <StatusBadge tone="success" label="Validé" /> : <StatusBadge tone="warning" label="À valider" />}
                          {l.type === "BUSINESS_ADDRESS" && <StatusBadge tone="warning" label="Commandes du Japon uniquement" dot={false} />}
                        </div>
                        {l.type !== "BUSINESS_ADDRESS" && (
                          <p className="text-sm">
                            {networkLabel(l.network)} — <span className="font-medium">{l.relayName}</span>
                            {l.externalId && <span className="text-muted-foreground"> · ID {l.externalId}</span>}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {[l.addressLine1, l.addressLine2, `${l.postalCode} ${l.city}`, l.country].filter(Boolean).join(", ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Destinataire : <span className="text-foreground">{l.recipientName}</span>
                          {" · "}Tél. : {l.recipientPhone ?? preparer.user.phone ?? <span className="text-warning">non renseigné</span>}
                          {l.openingHours && ` · ${l.openingHours}`}
                        </p>
                        {l.validatedAt && (
                          <p className="text-xs text-muted-foreground">
                            Validé le {formatDateTime(l.validatedAt)}
                            {l.validatedBy && ` par ${fullName(l.validatedBy)}`}
                          </p>
                        )}
                      </div>
                      {canManage && (
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          <LocationValidationButton locationId={l.id} preparerId={preparer.id} validated={!!l.validatedAt} />
                          <LocationDialog
                            preparerId={preparer.id}
                            defaultRecipient={name}
                            defaultPhone={preparer.user.phone}
                            location={{
                              id: l.id,
                              type: l.type,
                              label: l.label,
                              network: l.network,
                              relayName: l.relayName,
                              addressLine1: l.addressLine1,
                              addressLine2: l.addressLine2,
                              postalCode: l.postalCode,
                              city: l.city,
                              country: l.country,
                              externalId: l.externalId,
                              recipientName: l.recipientName,
                              recipientPhone: l.recipientPhone,
                              openingHours: l.openingHours,
                              instructions: l.instructions,
                              isPrimary: l.isPrimary,
                              validated: !!l.validatedAt,
                            }}
                          />
                          <DeactivateLocationButton locationId={l.id} preparerId={preparer.id} />
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {inactiveLocations.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {inactiveLocations.length} lieu(x) désactivé(s) conservé(s) pour l&apos;historique des commandes.
              </p>
            )}
          </Section>

          <Section
            title="Clients attribués"
            actions={
              canAssign ? (
                <AssignCustomerDialog
                  preparerId={preparer.id}
                  preparerName={name}
                  customers={assignable}
                  disabledReason={capacity && !capacity.available ? capacity.unavailableReason : null}
                />
              ) : null
            }
          >
            {preparer.currentCustomers.length === 0 ? (
              <EmptyState icon={Users} title="Aucun client attribué" />
            ) : (
              <ul className="divide-y">
                {preparer.currentCustomers.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link href={`/admin/clients/${c.id}`} className="text-sm font-medium hover:underline">
                        {fullName(c.user)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.referenceCode} · {c.subscriptions[0]?.plan.name ?? "Sans abonnement actif"}
                      </p>
                    </div>
                    {canAssign && (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/clients/${c.id}`}>Réattribuer</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Section title="Commandes récentes">
              {ops.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune commande.</p>
              ) : (
                <ul className="divide-y">
                  {ops.orders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/admin/commandes/${o.id}`} className="text-sm font-medium hover:underline">
                          {o.reference}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {o.customer.referenceCode} · {o.description}
                        </p>
                      </div>
                      <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Expéditions récentes">
              {ops.shipments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune expédition.</p>
              ) : (
                <ul className="divide-y">
                  {ops.shipments.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/admin/expeditions/${s.id}`} className="text-sm font-medium hover:underline">
                          {s.reference}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.customer.referenceCode} · {s.recipientName}
                        </p>
                      </div>
                      <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        <div className="space-y-6">
          <Section title="Capacité">
            <div className="grid gap-4">
              <CapacityBar label="Clients" value={stats.clients} max={preparer.maxClients} />
              <CapacityBar label="Stockage (articles)" value={stats.storedUnits} max={preparer.storageCapacity} />
              {capacity && !capacity.available && <p className="text-xs text-warning">Non disponible à l&apos;attribution : {capacity.unavailableReason}.</p>}
            </div>
          </Section>

          <Section title="Coordonnées">
            <dl className="grid gap-3">
              <KeyValue label="E-mail">
                <a href={`mailto:${preparer.user.email}`} className="hover:underline">
                  {preparer.user.email}
                </a>
              </KeyValue>
              <KeyValue label="Téléphone">{preparer.user.phone ?? "—"}</KeyValue>
              <KeyValue label="Ville et pays">
                {preparer.city} ({preparer.country})
              </KeyValue>
              <KeyValue label="Transporteurs compatibles">{preparer.compatibleCarriers.length ? preparer.compatibleCarriers.map(carrierLabel).join(", ") : "—"}</KeyValue>
              <KeyValue label="Dernière connexion">{formatDateTime(preparer.user.lastLoginAt)}</KeyValue>
            </dl>
          </Section>

          <Section
            title={
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5 text-muted-foreground" /> Confidentiel
              </span>
            }
            description="Visible uniquement par l'administration."
          >
            <dl className="grid gap-3">
              <KeyValue label="Adresse personnelle">
                {preparer.businessAddressLine1 ? (
                  <div className="grid gap-2">
                    <span>
                      {[preparer.businessAddressLine1, preparer.businessAddressLine2, `${preparer.businessPostalCode ?? ""} ${preparer.businessCity ?? ""}`.trim()].filter(Boolean).join(", ")}
                    </span>
                    <span className="text-xs text-warning">Ancienne adresse, plus utilisée : les colis arrivent en lockers, points relais ou poste restante.</span>
                    {canManage && (
                      <ActionButton action={clearPreparerAddressAction} fields={{ preparerId: preparer.id }} variant="outline" size="sm" className="w-fit">
                        Effacer cette adresse
                      </ActionButton>
                    )}
                  </div>
                ) : (
                  "Aucune : jamais demandée"
                )}
              </KeyValue>
              <KeyValue label="Notes internes">{preparer.adminNotes ? <span className="whitespace-pre-wrap">{preparer.adminNotes}</span> : "—"}</KeyValue>
            </dl>
          </Section>

          <Section title="Disponibilités" description={preparer.availabilityNote ?? undefined}>
            {availability ? (
              <ul className="grid gap-1.5 text-sm">
                {DAYS.map((d) => {
                  const slot = availability[d.key];
                  return (
                    <li key={d.key} className="flex justify-between">
                      <span className="text-muted-foreground">{d.label}</span>
                      <span className="tabular">{slot?.open ? `${slot.from} – ${slot.to}` : "Fermé"}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Non renseignées.</p>
            )}
          </Section>

          <Section title="Absences" actions={canManage ? <AbsenceDialog preparerId={preparer.id} /> : null}>
            {preparer.absences.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune absence déclarée.</p>
            ) : (
              <ul className="grid gap-2">
                {preparer.absences.map((a) => {
                  const current = a.startsAt <= now && a.endsAt >= now;
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                      <div>
                        <p className={cn(current && "font-medium text-warning")}>
                          {formatDate(a.startsAt)} → {formatDate(a.endsAt)}
                          {current && " · en cours"}
                        </p>
                        {a.reason && <p className="text-xs text-muted-foreground">{a.reason}</p>}
                      </div>
                      {canManage && a.endsAt >= now && <CancelAbsenceButton absenceId={a.id} preparerId={preparer.id} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
