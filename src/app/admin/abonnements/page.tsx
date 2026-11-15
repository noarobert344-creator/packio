import type { Metadata } from "next";
import Link from "next/link";
import { BadgeEuro, CalendarX2, CircleAlert, CreditCard, ExternalLink } from "lucide-react";
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { isWhopConfigured } from "@/server/billing";
import { PAGE_SIZE, listSubscriptions } from "@/server/queries/admin-ops";
import { saveCreditPackAction, savePlanAction, saveSizeRulesAction } from "@/server/actions/admin/ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { ActionDialog } from "@/components/shared/action-dialog";
import { CheckboxField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FilterSelect, Pagination } from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerLink, Notice } from "@/components/admin/ops/ui";
import { SUBSCRIPTION_STATUS } from "@/lib/labels";
import { CREDIT_PACK_SIZES, MIN_CREDIT_PRICE_CENTS } from "@/lib/credit-packs";
import { formatDate, formatMoney, formatPrice } from "@/lib/format";
import { annualSavingsLabel, monthlyEquivalentCents } from "@/lib/billing-intervals";
import { oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Abonnements" };

const SUB_STATUSES = Object.keys(SUBSCRIPTION_STATUS) as SubscriptionStatus[];
const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export default async function AdminSubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin("billing.read");
  const canEdit = can(actor, "billing.manage");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const status = oneOf(sp.statut, SUB_STATUSES);
  const whop = isWhopConfigured();
  const [plans, rules, packs, subs] = await Promise.all([
    db.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } } } } } } }),
    db.parcelSizeRule.findMany({ orderBy: { sortOrder: "asc" } }),
    db.creditPack.findMany({ where: { credits: { in: [...CREDIT_PACK_SIZES] } }, orderBy: { credits: "asc" } }),
    listSubscriptions({ status, page }),
  ]);

  return (
    <>
      <PageHeader title="Abonnements et offres" description="Offres commerciales, coût des catégories de colis, crédits supplémentaires, codes promotionnels et abonnements en cours. Paiements gérés par Whop." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenu mensuel récurrent" value={formatMoney(subs.kpis.mrrCents)} icon={BadgeEuro} tone="brand" hint="Abonnements à jour, annuel ramené au mois" />
        <StatCard label="Abonnements actifs" value={subs.kpis.active} icon={CreditCard} tone="success" hint={`Dont ${subs.kpis.yearly} en formule annuelle`} />
        <StatCard label="Impayés" value={subs.kpis.pastDue} icon={CircleAlert} tone={subs.kpis.pastDue ? "danger" : "default"} href="/admin/paiements?onglet=echecs" />
        <StatCard label="Résiliations programmées" value={subs.kpis.cancelScheduled} icon={CalendarX2} tone={subs.kpis.cancelScheduled ? "warning" : "default"} />
      </div>

      {!whop && (
        <Notice className="mb-6">
          Whop n&apos;est pas configuré{env.billingMode === "dev" ? " — mode de paiement de démonstration actif (aucun encaissement)" : ""}. Renseignez <code>WHOP_API_KEY</code>, <code>WHOP_ACCOUNT_ID</code> et <code>WHOP_WEBHOOK_SECRET</code> pour encaisser les paiements.
        </Notice>
      )}

      <div className="space-y-6">
        <Section
          title="Offres"
          description="Paramètres modifiables : prix mensuel et annuel, crédits mensuels, limite de stockage et contenu affiché sur le site. La formule annuelle est payée en une fois et verse les crédits chaque mois ; laissez son prix vide pour ne pas la proposer. Sans plan Whop renseigné, un plan masqué au prix indiqué est créé automatiquement au paiement ; les abonnés existants conservent leur tarif."
        >
          <div className="grid gap-4 xl:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className="rounded-2xl border p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p._count.subscriptions} abonné(s) actif(s) · code {p.code}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    {p.highlighted && <StatusBadge tone="brand" label="Mise en avant" dot={false} />}
                    <StatusBadge tone={p.isActive ? "success" : "neutral"} label={p.isActive ? "Active" : "Inactive"} />
                  </div>
                </div>
                {canEdit ? (
                  <ActionForm action={savePlanAction} className="grid gap-3">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="code" value={p.code} />
                    <div className="grid grid-cols-2 gap-3">
                      <TextField name="name" label="Nom" defaultValue={p.name} required />
                      <TextField
                        name="price"
                        label="Prix mensuel (€ TTC)"
                        defaultValue={euros(p.priceCents)}
                        inputMode="decimal"
                        required
                        hint={`Minimum ${formatMoney(p.monthlyCredits * MIN_CREDIT_PRICE_CENTS)} (1,90 € le crédit)`}
                      />
                      <TextField
                        name="annualPrice"
                        label="Prix annuel (€ TTC)"
                        defaultValue={p.annualPriceCents ? euros(p.annualPriceCents) : ""}
                        inputMode="decimal"
                        placeholder="Non proposé"
                        hint={annualSavingsLabel(p) ? `${annualSavingsLabel(p)} · ${formatMoney(monthlyEquivalentCents(p, "YEARLY"))} / mois` : "Vide = pas de formule annuelle"}
                      />
                      <TextField name="monthlyCredits" label="Crédits / mois" type="number" min={0} defaultValue={p.monthlyCredits} required />
                      <TextField name="storageLimit" label="Limite de stockage" type="number" min={0} defaultValue={p.storageLimit ?? ""} placeholder="Illimité" hint="En articles" />
                    </div>
                    <TextField name="tagline" label="Accroche" defaultValue={p.tagline ?? ""} />
                    <TextAreaField name="features" label="Avantages affichés (un par ligne)" defaultValue={p.features.join("\n")} rows={5} />
                    <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                      <div className="grid gap-2">
                        <CheckboxField name="highlighted" label="Mettre en avant" defaultChecked={p.highlighted} />
                        <CheckboxField name="isActive" label="Offre proposée à la souscription" defaultChecked={p.isActive} />
                      </div>
                      <TextField name="sortOrder" label="Ordre" type="number" min={0} defaultValue={p.sortOrder} className="w-20" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <TextField name="whopPlanId" label="Plan Whop mensuel" defaultValue={p.whopPlanId ?? ""} placeholder="plan_…" hint="Facultatif, tous les 30 jours, même prix." />
                      <TextField name="whopAnnualPlanId" label="Plan Whop annuel" defaultValue={p.whopAnnualPlanId ?? ""} placeholder="plan_…" hint="Facultatif, tous les 365 jours, même prix." />
                    </div>
                    <SubmitButton pendingLabel="Enregistrement…">Enregistrer l&apos;offre</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-sm">
                    {formatMoney(p.priceCents)} / mois{p.annualPriceCents ? ` · ${formatPrice(p.annualPriceCents)} / an` : ""} · {p.monthlyCredits} crédits · stockage {p.storageLimit ?? "illimité"}
                  </p>
                )}
                <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                  <span className="block font-mono">Mensuel : {p.whopPlanId ?? "plan Whop créé au paiement"}</span>
                  <span className="block font-mono">Annuel : {p.annualPriceCents ? (p.whopAnnualPlanId ?? "plan Whop créé au paiement") : "non proposé"}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Coût des catégories de colis"
          description="Le préparateur choisit la catégorie ; le coût en crédits et les dimensions maximales sont définis ici. Les frais de transport restent distincts des crédits."
        >
          <ActionForm action={saveSizeRulesAction} className="grid gap-4">
            <div className="grid gap-4 lg:grid-cols-3">
              {rules.map((r) => (
                <fieldset key={r.size} disabled={!canEdit} className="grid gap-3 rounded-2xl border p-4">
                  <legend className="px-1 text-sm font-semibold">{r.label}</legend>
                  <div className="grid grid-cols-[1fr_6rem] gap-3">
                    <TextField name={`${r.size}.label`} label="Libellé" defaultValue={r.label} required />
                    <TextField name={`${r.size}.creditCost`} label="Crédits" type="number" min={0} defaultValue={r.creditCost} required />
                  </div>
                  <TextField name={`${r.size}.description`} label="Exemples" defaultValue={r.description ?? ""} />
                  <div className="grid grid-cols-3 gap-2">
                    <TextField name={`${r.size}.maxLengthCm`} label="L max (cm)" type="number" min={0} defaultValue={r.maxLengthCm ?? ""} />
                    <TextField name={`${r.size}.maxWidthCm`} label="l max (cm)" type="number" min={0} defaultValue={r.maxWidthCm ?? ""} />
                    <TextField name={`${r.size}.maxHeightCm`} label="H max (cm)" type="number" min={0} defaultValue={r.maxHeightCm ?? ""} />
                  </div>
                  <TextField name={`${r.size}.maxWeightGrams`} label="Poids max (g)" type="number" min={0} defaultValue={r.maxWeightGrams ?? ""} hint="Vide = sans limite" />
                </fieldset>
              ))}
            </div>
            {canEdit && (
              <div>
                <SubmitButton pendingLabel="Enregistrement…">Enregistrer les catégories</SubmitButton>
              </div>
            )}
          </ActionForm>
        </Section>

        <Section
          title="Crédits supplémentaires"
          description="Les clients abonnés peuvent acheter 10, 30, 50 ou 100 crédits. Seuls le prix, l'affichage et le plan Whop sont modifiables. La politique d'expiration se règle dans Crédits."
          contentClassName="p-0"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Recharge</TableHead>
                <TableHead className="text-right">Crédits</TableHead>
                <TableHead className="text-right">Prix</TableHead>
                <TableHead className="text-right">Prix / crédit</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="pr-5 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packs.map((pk) => (
                <TableRow key={pk.id}>
                  <TableCell className="pl-5 font-medium">{pk.name}</TableCell>
                  <TableCell className="text-right tabular">{pk.credits}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(pk.priceCents, pk.currency)}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular">{formatMoney(Math.round(pk.priceCents / pk.credits), pk.currency)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={pk.isActive ? "success" : "neutral"} label={pk.isActive ? "Proposée" : "Masquée"} />
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {canEdit && (
                      <ActionDialog trigger={<Button variant="ghost" size="sm">Modifier</Button>} title={`Modifier « ${pk.name} »`} action={saveCreditPackAction} submitLabel="Enregistrer">
                        <input type="hidden" name="id" value={pk.id} />
                        <PackFields pack={pk} />
                      </ActionDialog>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {packs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Aucune recharge : lancez « npm run db:bootstrap » pour créer les recharges 10, 30, 50 et 100.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Section>

        <Section title="Codes promotionnels" description="Les codes promo sont créés et suivis dans Whop ; vos clients les saisissent sur la page de paiement Whop (abonnement et crédits).">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Créez un code (pourcentage ou montant, durée, nombre d&apos;utilisations, date d&apos;expiration) depuis votre tableau de bord Whop.</p>
            <Button asChild variant="outline" size="sm">
              <a href="https://whop.com/dashboard" target="_blank" rel="noopener noreferrer">
                Ouvrir le tableau de bord Whop <ExternalLink />
              </a>
            </Button>
          </div>
        </Section>

        <Section
          title="Abonnements"
          actions={<FilterSelect param="statut" options={SUB_STATUSES.map((v) => ({ value: v, label: SUBSCRIPTION_STATUS[v].label }))} placeholder="Tous les statuts" />}
          contentClassName="p-0"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Client</TableHead>
                <TableHead>Offre</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Fin de période</TableHead>
                <TableHead>Renouvellement</TableHead>
                <TableHead>Prestataire</TableHead>
                <TableHead className="pr-5">Créé le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-5">
                    <CustomerLink customer={s.customer} />
                  </TableCell>
                  <TableCell>
                    {s.plan.name}
                    <span className="block text-xs text-muted-foreground">
                      {s.billingInterval === "YEARLY" ? `Annuel · ${formatPrice(s.plan.annualPriceCents, s.plan.currency)} / an` : `Mensuel · ${formatMoney(s.plan.priceCents, s.plan.currency)} / mois`}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusFrom map={SUBSCRIPTION_STATUS} value={s.status} />
                  </TableCell>
                  <TableCell>{formatDate(s.currentPeriodEnd)}</TableCell>
                  <TableCell>
                    {s.status === "CANCELED" ? (
                      "—"
                    ) : s.supersededAt ? (
                      <StatusBadge tone="neutral" label="Remplacé (non renouvelé)" />
                    ) : s.pendingBillingInterval ? (
                      <StatusBadge tone="brand" label="Passage au mensuel" />
                    ) : s.cancelAtPeriodEnd ? (
                      <StatusBadge tone="warning" label="Résiliation programmée" />
                    ) : s.pendingPlanId ? (
                      <StatusBadge tone="brand" label="Changement programmé" />
                    ) : (
                      "Automatique"
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.provider === "dev" ? "Démonstration" : s.provider === "whop" ? "Whop" : s.provider}</TableCell>
                  <TableCell className="pr-5 text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                </TableRow>
              ))}
              {subs.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Aucun abonnement.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="px-5 pb-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={subs.total} basePath="/admin/abonnements" params={{ statut: status }} />
          </div>
        </Section>
        <p className="text-xs text-muted-foreground">
          Les clients gèrent leur moyen de paiement et leurs reçus depuis leur espace (lien vers Whop). Voir aussi <Link href="/admin/paiements" className="underline">Paiements</Link>.
        </p>
      </div>
    </>
  );
}

function PackFields({ pack }: { pack: { name: string; credits: number; priceCents: number; isActive: boolean; sortOrder: number; whopPlanId: string | null } }) {
  return (
    <>
      <input type="hidden" name="credits" value={pack.credits} />
      <input type="hidden" name="sortOrder" value={pack.sortOrder} />
      <TextField name="name" label="Nom affiché" required defaultValue={pack.name} />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="creditsDisplay" label="Crédits" defaultValue={String(pack.credits)} disabled hint="10, 30, 50 ou 100" />
        <TextField name="price" label="Prix (€ TTC)" required inputMode="decimal" defaultValue={euros(pack.priceCents)} hint={`Minimum ${formatMoney(pack.credits * MIN_CREDIT_PRICE_CENTS)}`} />
      </div>
      <TextField name="whopPlanId" label="Plan Whop (facultatif)" defaultValue={pack.whopPlanId ?? ""} placeholder="plan_…" hint="Plan à paiement unique au même prix ; sinon créé au paiement." />
      <CheckboxField name="isActive" label="Proposée aux clients" defaultChecked={pack.isActive} />
    </>
  );
}
