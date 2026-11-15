import { nowMs } from "@/server/lib/clock";
import type { Metadata } from "next";
import { ExternalLink, KeyRound, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AssignmentWaiting } from "@/components/client/assignment-waiting";
import { ReceptionCard } from "@/components/client/reception-card";
import { NewOrderForm } from "@/components/client/new-order-form";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { getReceptionInfo } from "@/server/services/orders";
import { LOCATION_TYPE } from "@/lib/labels";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Commander des articles" };

export default async function OrderPage({ searchParams }: { searchParams: SearchParams }) {
  const { customer } = await requireSubscribedCustomer();
  const sp = await searchParams;
  if (!customer.currentPreparerId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Commander des articles" description="Les coordonnées de réception apparaîtront dès l'attribution de votre préparateur." />
        {customer.assignmentState !== "ASSIGNED" && customer.assignmentState !== "NOT_REQUESTED" ? (
          <AssignmentWaiting serverNow={nowMs()} requestedAt={customer.assignmentRequestedAt?.toISOString() ?? null} dueAt={customer.assignmentDueAt?.toISOString() ?? null} state={customer.assignmentState} />
        ) : (
          <EmptyState icon={MapPin} title="Préparateur non attribué" />
        )}
      </div>
    );
  }
  const info = await getReceptionInfo(customer.id);
  return (
    <div className="space-y-8">
      <PageHeader
        title="Commander des articles"
        description="Achetez sur Vinted, ZenMarket, SHEIN, AliExpress ou toute boutique compatible, en vous faisant livrer au point de réception de votre préparateur. Déclarez ensuite la commande ici."
        actions={
          <Button asChild>
            <a href="#nouvelle-commande">Nouvelle commande</a>
          </Button>
        }
      />
      <ol className="grid gap-3 text-sm sm:grid-cols-3">
        {[
          "Choisissez un point de réception compatible avec le fournisseur et copiez ses coordonnées.",
          "Passez commande chez le fournisseur avec le nom du destinataire et votre code client.",
          "Déclarez la commande ci-dessous, puis ajoutez le suivi et le code de retrait dès réception.",
        ].map((t, i) => (
          <li key={i} className="flex gap-3 rounded-2xl border bg-card p-4">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground">{i + 1}</span>
            <span className="text-muted-foreground">{t}</span>
          </li>
        ))}
      </ol>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Coordonnées de réception</h2>
        {info.locations.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {info.locations.map((l) => (
              <ReceptionCard key={l.id} location={l} clientCode={customer.referenceCode} />
            ))}
          </div>
        ) : (
          <EmptyState icon={MapPin} title="Aucun point de réception validé" description="L'équipe Packio valide actuellement les points de réception de votre préparateur." />
        )}
      </div>

      <Section title="Fournisseurs et compatibilité" description="Packio ne suppose pas qu'un fournisseur livre partout : chaque combinaison fournisseur / point de réception est vérifiée." contentClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {info.suppliers.map((s) => {
          const okCount = Object.values(s.compatibility).filter((c) => c.ok).length;
          return (
            <div key={s.id} className="flex flex-col gap-2 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{s.name}</p>
                <span className={okCount ? "text-xs text-success" : "text-xs text-muted-foreground"}>
                  {okCount} / {info.locations.length} point(s) compatible(s)
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Livre vers : {s.acceptedLocationTypes.map((t) => LOCATION_TYPE[t]).join(", ")}
              </p>
              {s.requiresPickupCode && (
                <p className="flex items-center gap-1 text-xs text-warning">
                  <KeyRound className="size-3" /> Code de retrait à transmettre
                </p>
              )}
              {s.compatibilityNotes && <p className="text-xs text-muted-foreground">{s.compatibilityNotes}</p>}
              {s.websiteUrl && (
                <Button asChild variant="outline" size="sm" className="mt-auto w-fit">
                  <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer">
                    Ouvrir le fournisseur <ExternalLink />
                  </a>
                </Button>
              )}
            </div>
          );
        })}
      </Section>

      <div id="nouvelle-commande" className="scroll-mt-24">
        <Section title="Nouvelle commande" description="Ces informations permettent à votre préparateur d'identifier et de contrôler votre colis.">
          <NewOrderForm
            defaultSupplier={one(sp.fournisseur)?.toUpperCase()}
            suppliers={info.suppliers.map((s) => ({
              id: s.id,
              code: s.code,
              name: s.name,
              websiteUrl: s.websiteUrl,
              requiresPickupCode: s.requiresPickupCode,
              compatibilityNotes: s.compatibilityNotes,
              compatibility: s.compatibility,
            }))}
            locations={info.locations.map((l) => ({ id: l.id, label: l.label, detail: l.relayName ? `${l.relayName}, ${l.city}` : `${l.addressLine1}, ${l.city}` }))}
          />
        </Section>
      </div>
    </div>
  );
}
