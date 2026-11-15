import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { auditEntityTypes, listAuditLogs } from "@/server/queries/admin-ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportLink } from "@/components/admin/ops/ui";
import { formatDateTime, fullName } from "@/lib/format";
import { one, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Journal d'audit" };

const ENTITY_LABEL: Record<string, string> = {
  customer: "Client",
  user: "Utilisateur",
  preparer: "Préparateur",
  preparer_location: "Lieu de réception",
  shipment: "Expédition",
  incident: "Incident",
  inventory_item: "Article",
  payment: "Paiement",
  plan: "Offre",
  credit_pack: "Recharge",
  parcel_size_rule: "Catégorie de colis",
  supplier: "Fournisseur",
  setting: "Paramètre",
  role: "Rôle",
  conversation: "Conversation",
  promotion_code: "Code promotionnel",
  export: "Export",
};

function entityHref(type: string, id: string | null) {
  if (!id) return null;
  switch (type) {
    case "customer":
      return `/admin/clients/${id}`;
    case "preparer":
      return `/admin/preparateurs/${id}`;
    case "shipment":
      return `/admin/expeditions/${id}`;
    case "incident":
      return `/admin/incidents/${id}`;
    case "inventory_item":
      return `/admin/stocks/${id}`;
    default:
      return null;
  }
}

export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("audit.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const f = { action: one(sp.q), entityType: one(sp.entite), actor: one(sp.acteur) };
  const [{ items, total }, types] = await Promise.all([listAuditLogs({ ...f, page }), auditEntityTypes()]);

  return (
    <>
      <PageHeader
        title="Journal d'audit"
        description="Trace inaltérable des actions sensibles : attributions, crédits manuels, remboursements, accès de supervision, modifications de paramètres…"
        actions={<ExportLink entity="audit" params={{ q: f.action, entite: f.entityType, acteur: f.actor }} />}
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput placeholder="Action (ex. credits, assignment…)" />
        <SearchInput param="acteur" placeholder="Auteur (nom, e-mail)" />
        <FilterSelect param="entite" options={types.map((t) => ({ value: t, label: ENTITY_LABEL[t] ?? t }))} placeholder="Tous les objets" />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Aucune entrée" description="Aucune action ne correspond à ces critères." />
      ) : (
        <Section contentClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Date</TableHead>
                <TableHead>Auteur</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead className="min-w-72 pr-5">Détail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((l) => {
                const href = entityHref(l.entityType, l.entityId);
                const meta = l.metadata && typeof l.metadata === "object" && Object.keys(l.metadata).length ? JSON.stringify(l.metadata, null, 2) : null;
                return (
                  <TableRow key={l.id} className="align-top">
                    <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(l.createdAt)}</TableCell>
                    <TableCell className="text-xs">
                      {l.actor ? (
                        <>
                          <span className="font-medium">{fullName(l.actor)}</span>
                          <span className="block text-muted-foreground">{l.actor.email}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Système</span>
                      )}
                      {l.actorRole && <span className="block text-[0.7rem] text-muted-foreground/80">{l.actorRole}</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.action}</TableCell>
                    <TableCell className="text-xs">
                      {ENTITY_LABEL[l.entityType] ?? l.entityType}
                      {l.entityId &&
                        (href ? (
                          <Link href={href} className="block font-mono text-brand hover:underline">
                            {l.entityId.slice(0, 12)}…
                          </Link>
                        ) : (
                          <span className="block font-mono text-muted-foreground">{l.entityId.slice(0, 12)}…</span>
                        ))}
                    </TableCell>
                    <TableCell className="max-w-md pr-5 text-xs whitespace-normal">
                      {l.summary ?? <span className="text-muted-foreground">—</span>}
                      {meta && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Métadonnées</summary>
                          <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-muted p-2 text-[0.7rem] whitespace-pre-wrap">{meta}</pre>
                        </details>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      )}
      <Pagination page={page} pageSize={50} total={total} basePath="/admin/audit" params={{ q: f.action, entite: f.entityType, acteur: f.actor }} />
    </>
  );
}
