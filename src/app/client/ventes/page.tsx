import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, KeyRound, MousePointerClick, PlugZap, Puzzle, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { FilterTabs } from "@/components/shared/list-controls";
import { SalesList } from "@/components/client/sales-list";
import { EmptyState } from "@/components/shared/empty-state";
import { ActionButton } from "@/components/shared/action-dialog";
import { ExtensionTokenForm } from "@/components/client/extension-token-form";
import { ExtensionConnect } from "@/components/client/extension-connect";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { SALE_FILTERS, listMarketplaceOverview, type SaleFilter } from "@/server/services/marketplace";
import { createExtensionTokenAction, revokeExtensionTokenAction } from "@/server/actions/marketplace";
import { MARKETPLACE_PLATFORM } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Ventes et comptes liés" };

const STEPS = [
  { icon: Puzzle, title: "Installez Packio Connect", text: "L'extension pour Chrome lit vos ventes Vinted et Vestiaire Collective, depuis votre navigateur, avec vos propres sessions." },
  { icon: Inbox, title: "Vos ventes arrivent ici", text: "Chaque article vendu apparaît tout seul dans « Toutes mes ventes », avec la photo, le prix et l'acheteur." },
  {
    icon: MousePointerClick,
    title: "Un clic par vente",
    text: "« Vente normale » : l'article est dans votre stock, votre préparateur l'expédie. « Vente dropshipping » : il est commandé chez le fournisseur. « Supprimer » : vous l'expédiez vous-même.",
  },
];

const PAGE = 30;

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const { customer } = await requireSubscribedCustomer();
  const sp = await searchParams;
  const requested = one(sp.ventes);
  const filter: SaleFilter = (SALE_FILTERS as readonly string[]).includes(requested ?? "") ? (requested as SaleFilter) : "toutes";
  const limit = Math.min(Math.max(Number.parseInt(one(sp.n) ?? "", 10) || PAGE, PAGE), 300);
  const { accounts, tokens, sales, salesFilter, hasMoreSales, saleCounts, stockItems } = await listMarketplaceOverview(customer.id, { salesFilter: filter, salesLimit: limit });
  // Deux articles du même nom : on précise la date d'arrivée pour les distinguer.
  const names = new Map<string, number>();
  for (const i of stockItems) names.set(i.name, (names.get(i.name) ?? 0) + 1);
  const itemOptions = stockItems.map((i) => ({
    value: i.id,
    label: `${i.name}${(names.get(i.name) ?? 0) > 1 ? ` · arrivé le ${formatDate(i.receivedAt)}` : ""} (${i.quantityAvailable} dispo.)`,
  }));
  const activeTokens = tokens.filter((t) => !t.revokedAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventes et comptes liés"
        description="Reliez vos comptes Vinted et Vestiaire Collective : toutes vos ventes arrivent ici, et vous choisissez pour chacune ce que Packio en fait."
      />

      <div className="grid gap-3 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-2xl border bg-card p-5 shadow-soft">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{i + 1}</span>
              <s.icon className="size-4 text-brand" />
            </div>
            <p className="mt-3 font-medium">{s.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
          </div>
        ))}
      </div>

      <Section
        title="Toutes mes ventes"
        description="Sous chaque article vendu, choisissez : « Vente normale » (l'article est dans votre stock, votre préparateur l'expédie), « Vente dropshipping » (commandé chez le fournisseur, expédié dès réception) ou « Supprimer » (vous l'expédiez vous-même)."
      >
        <div className="space-y-4">
          <FilterTabs
            param="ventes"
            options={[
              { value: "", label: "Toutes", count: saleCounts.toutes },
              { value: "a-traiter", label: "À traiter", count: saleCounts["a-traiter"] },
              { value: "packio", label: "Ventes normales", count: saleCounts.packio },
              { value: "dropshipping", label: "Ventes dropshipping", count: saleCounts.dropshipping },
            ]}
          />
          {sales.length ? (
            <>
              <SalesList sales={sales} itemOptions={itemOptions} />
              {hasMoreSales && (
                <div className="flex justify-center">
                  <Button asChild variant="outline">
                    <Link href={`/client/ventes?${new URLSearchParams({ ...(salesFilter !== "toutes" ? { ventes: salesFilter } : {}), n: String(limit + PAGE) })}`} scroll={false}>
                      Voir plus de ventes
                    </Link>
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={Store}
              title={
                salesFilter === "a-traiter"
                  ? "Aucune vente à traiter"
                  : salesFilter === "packio"
                    ? "Aucune vente normale"
                    : salesFilter === "dropshipping"
                      ? "Aucune vente en dropshipping"
                      : "Aucune vente pour l'instant"
              }
              description="Installez l'extension et restez connecté à Vinted ou Vestiaire Collective : vos ventes apparaîtront ici."
            />
          )}
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Extension Packio Connect" description="Elle relie vos comptes Vinted et Vestiaire Collective à Packio, depuis votre navigateur, sans jamais connaître vos mots de passe.">
          <ExtensionConnect storeUrl={process.env.EXTENSION_STORE_URL?.startsWith("https://") ? process.env.EXTENSION_STORE_URL : null} />
          <details className="mt-5 rounded-xl border p-4 text-sm">
            <summary className="cursor-pointer font-medium">Connexion manuelle (jeton personnel)</summary>
            <p className="mt-2 mb-3 text-xs text-muted-foreground">À utiliser si la connexion en un clic n&apos;est pas possible : créez un jeton et collez-le dans les options de l&apos;extension.</p>
            <ExtensionTokenForm action={createExtensionTokenAction} />
          </details>
          {tokens.length > 0 && (
            <ul className="mt-5 divide-y rounded-xl border">
              {tokens.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <KeyRound className="size-3.5 text-muted-foreground" /> {t.label}
                      <span className="font-mono text-xs text-muted-foreground">{t.prefix}…</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Créé le {formatDate(t.createdAt)} · {t.lastUsedAt ? `utilisé le ${formatDateTime(t.lastUsedAt)}` : "jamais utilisé"}
                    </p>
                  </div>
                  {t.revokedAt ? (
                    <StatusBadge tone="neutral" label={`Révoqué le ${formatDate(t.revokedAt)}`} />
                  ) : (
                    <ActionButton action={revokeExtensionTokenAction} fields={{ tokenId: t.id }} variant="outline" size="sm">
                      Révoquer
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!activeTokens.length && tokens.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Aucun jeton actif : l&apos;extension est déconnectée.</p>}
        </Section>

        <Section title="Comptes liés" description="Comptes détectés par l'extension lors de la dernière synchronisation.">
          {accounts.length ? (
            <ul className="divide-y rounded-xl border">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{MARKETPLACE_PLATFORM[a.platform]}</p>
                    <p className="text-xs text-muted-foreground">{a.username ?? `Compte n° ${a.externalUserId}`}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{a.lastSyncAt ? `Synchronisé le ${formatDateTime(a.lastSyncAt)}` : "Jamais synchronisé"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={PlugZap} title="Aucun compte lié" description="Après l'installation de l'extension, vos comptes apparaissent ici dès la première synchronisation." />
          )}
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            L&apos;extension lit uniquement vos propres annonces, ventes et bordereaux, avec la session ouverte dans votre navigateur. Packio ne connaît jamais vos
            identifiants. Ces plateformes n&apos;autorisant pas toujours les outils automatisés, vous l&apos;utilisez sur vos comptes sous votre responsabilité.
          </p>
        </Section>
      </div>
    </div>
  );
}
