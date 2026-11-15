import type { Metadata } from "next";
import Link from "next/link";
import { Download, UserPlus, UserRound } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { listPreparersForAdmin } from "@/server/queries/admin-people";
import { listPreparerCapacities } from "@/server/services/assignments";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, SearchInput } from "@/components/shared/list-controls";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DemoBadge, TableWrap } from "@/components/admin/people/display";
import { CapacityBar } from "@/components/admin/people/capacity-bar";
import { PREPARER_STATUS } from "@/lib/labels";
import { formatDate, initials } from "@/lib/format";
import { one, oneOf, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Préparateurs — Administration" };

const STATUSES = ["ACTIVE", "UNAVAILABLE", "SUSPENDED"] as const;

export default async function AdminPreparersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin("preparers.read");
  const sp = await searchParams;
  const q = one(sp.q);
  const status = oneOf(sp.statut, STATUSES);
  const [preparers, capacities] = await Promise.all([listPreparersForAdmin({ q, status }), listPreparerCapacities()]);
  const canManage = can(actor, "preparers.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Préparateurs"
        description="Réseau des préparateurs : capacités, points de réception, statuts et clients attribués."
        actions={
          <>
            <Button asChild variant="outline">
            <a href="/api/admin/export/preparateurs" download>
                <Download /> CSV
              </a>
            </Button>
            {canManage && (
              <Button asChild>
                <Link href="/admin/preparateurs/nouveau">
                  <UserPlus /> Ajouter un préparateur
                </Link>
              </Button>
            )}
          </>
        }
      />
      <Section contentClassName="p-0">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Nom, e-mail, ville…" />
          <FilterSelect className="min-w-0 flex-1 sm:flex-none" param="statut" placeholder="Tous les statuts" options={STATUSES.map((s) => ({ value: s, label: PREPARER_STATUS[s].label }))} />
        </div>
        {preparers.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={UserRound} title="Aucun préparateur" description="Ajoutez un préparateur pour pouvoir attribuer vos clients.">
              {canManage && (
                <Button asChild>
                  <Link href="/admin/preparateurs/nouveau">Ajouter un préparateur</Link>
                </Button>
              )}
            </EmptyState>
          </div>
        ) : (
          <div className="px-5">
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Préparateur</TableHead>
                    <TableHead>Ville</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="min-w-36">Clients actifs</TableHead>
                    <TableHead className="min-w-36">Stock</TableHead>
                    <TableHead className="text-right">Colis traités</TableHead>
                    <TableHead>Points validés</TableHead>
                    <TableHead>Inscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preparers.map((p) => {
                    const cap = capacities.find((c) => c.id === p.id);
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="size-9">
                              {p.user.avatarFileId && <AvatarImage src={`/api/files/${p.user.avatarFileId}`} alt="" />}
                              <AvatarFallback className="bg-brand-soft text-xs font-semibold text-brand">{initials(p.user.firstName, p.user.lastName)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <Link href={`/admin/preparateurs/${p.id}`} className="font-medium hover:underline">
                                {p.user.firstName} {p.user.lastName}
                              </Link>
                              <DemoBadge show={p.user.isDemo} />
                              <p className="text-xs text-muted-foreground">{p.user.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{p.city}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <StatusFrom map={PREPARER_STATUS} value={p.status} />
                            {!p.user.passwordHash && <StatusBadge tone="neutral" label="Invitation en attente" dot={false} />}
                            {p.user.status !== "ACTIVE" && <StatusBadge tone="danger" label="Accès bloqué" dot={false} />}
                            {cap?.absentNow && <StatusBadge tone="warning" label="Absent" dot={false} />}
                          </div>
                        </TableCell>
                        <TableCell>
                          <CapacityBar value={p._count.assignments} max={p.maxClients} />
                        </TableCell>
                        <TableCell>
                          <CapacityBar value={cap?.storedUnits ?? 0} max={p.storageCapacity} />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular">{p.parcelsProcessed}</TableCell>
                        <TableCell className="text-sm tabular">{p._count.locations}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(p.joinedAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableWrap>
          </div>
        )}
      </Section>
    </div>
  );
}
