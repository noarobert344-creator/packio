import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, MessagesSquare, Package, Truck, Users } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { listMyClients } from "@/server/queries/preparer";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDate, initials } from "@/lib/format";

export const metadata: Metadata = { title: "Mes clients" };

export default async function PreparerClientsPage() {
  const actor = await requirePreparer();
  const clients = await listMyClients(actor.preparerId);
  return (
    <div>
      <PageHeader title="Mes clients" description="Clients qui vous sont attribués par l'équipe Packio. Identifiez leurs colis grâce à leur code client." />
      {clients.length === 0 ? (
        <EmptyState icon={Users} title="Aucun client attribué" description="L'équipe Packio vous notifiera dès qu'un client vous sera confié." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((c) => (
            <div key={c.assignmentId} className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
              <Link href={`/preparateur/clients/${c.customer.id}`} className="flex items-center gap-3">
                <Avatar className="size-11">
                  <AvatarFallback className="bg-brand-soft text-sm font-semibold text-brand">{initials(c.customer.user.firstName, c.customer.user.lastName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {c.customer.user.firstName} {c.customer.user.lastName}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-background">{c.customer.referenceCode}</span>
                    {c.plan ? `Offre ${c.plan}` : "Sans abonnement actif"}
                  </p>
                </div>
              </Link>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-muted/60 p-2.5">
                  <dt className="flex items-center justify-center gap-1 text-[0.7rem] text-muted-foreground">
                    <Boxes className="size-3" /> En stock
                  </dt>
                  <dd className="text-lg font-semibold tabular">{c.stockUnits}</dd>
                </div>
                <div className="rounded-xl bg-muted/60 p-2.5">
                  <dt className="flex items-center justify-center gap-1 text-[0.7rem] text-muted-foreground">
                    <Package className="size-3" /> Commandes
                  </dt>
                  <dd className="text-lg font-semibold tabular">{c.openOrders}</dd>
                </div>
                <div className="rounded-xl bg-muted/60 p-2.5">
                  <dt className="flex items-center justify-center gap-1 text-[0.7rem] text-muted-foreground">
                    <Truck className="size-3" /> Expéditions
                  </dt>
                  <dd className="text-lg font-semibold tabular">{c.activeShipments}</dd>
                </div>
              </dl>
              <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
                <span className="text-xs text-muted-foreground">Attribué le {formatDate(c.assignedAt)}</span>
                <div className="flex gap-1.5">
                  {c.conversationId && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/preparateur/messages?c=${c.conversationId}`}>
                        <MessagesSquare /> Message
                      </Link>
                    </Button>
                  )}
                  <Button asChild size="sm">
                    <Link href={`/preparateur/clients/${c.customer.id}`}>Ouvrir</Link>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
