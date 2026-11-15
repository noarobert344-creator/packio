import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { adminGlobalSearch } from "@/server/services/stats";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchInput } from "@/components/shared/list-controls";
import { INCIDENT_STATUS, SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { fullName } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Recherche — Administration" };

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <Section title={`${title} (${count})`} contentClassName="p-0">
      <ul className="divide-y">{children}</ul>
    </Section>
  );
}

function Row({ href, title, subtitle, right }: { href: string; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {right}
      </Link>
    </li>
  );
}

export default async function AdminSearchPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("customers.read");
  const q = one((await searchParams).q)?.trim() ?? "";
  const results = await adminGlobalSearch(q);
  const total = results.customers.length + results.preparers.length + results.orders.length + results.shipments.length + results.incidents.length;

  return (
    <div className="space-y-6">
      <PageHeader title="Recherche globale" description={q ? `Résultats pour « ${q} »` : "Recherchez un client, un préparateur, une référence de commande ou d'expédition, un numéro de suivi ou un incident."} />
      <SearchInput placeholder="Nom, e-mail, référence, numéro de suivi…" className="sm:w-96" />
      {q.length < 2 ? (
        <EmptyState icon={Search} title="Saisissez au moins 2 caractères" />
      ) : total === 0 ? (
        <EmptyState icon={Search} title="Aucun résultat" description="Vérifiez l'orthographe ou essayez une référence complète (ex. : EXP-…, CMD-…, PK-…)." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Group title="Clients" count={results.customers.length}>
            {results.customers.map((c) => (
              <Row key={c.id} href={`/admin/clients/${c.id}`} title={fullName(c.user)} subtitle={`${c.referenceCode} · ${c.user.email}`} />
            ))}
          </Group>
          <Group title="Préparateurs" count={results.preparers.length}>
            {results.preparers.map((p) => (
              <Row key={p.id} href={`/admin/preparateurs/${p.id}`} title={fullName(p.user)} subtitle={`${p.city} · ${p.user.email}`} />
            ))}
          </Group>
          <Group title="Commandes" count={results.orders.length}>
            {results.orders.map((o) => (
              <Row key={o.id} href={`/admin/commandes/${o.id}`} title={o.reference} subtitle={o.description} right={<StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />} />
            ))}
          </Group>
          <Group title="Expéditions" count={results.shipments.length}>
            {results.shipments.map((s) => (
              <Row key={s.id} href={`/admin/expeditions/${s.id}`} title={s.reference} subtitle={s.recipientName} right={<StatusFrom map={SHIPMENT_STATUS} value={s.status} />} />
            ))}
          </Group>
          <Group title="Incidents" count={results.incidents.length}>
            {results.incidents.map((i) => (
              <Row key={i.id} href={`/admin/incidents/${i.id}`} title={i.reference} subtitle={i.title} right={<StatusFrom map={INCIDENT_STATUS} value={i.status} />} />
            ))}
          </Group>
        </div>
      )}
    </div>
  );
}
