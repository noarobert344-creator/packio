import type { Metadata } from "next";
import Link from "next/link";
import { BadgeEuro, CalendarX2, CircleAlert, CreditCard, RefreshCw } from "lucide-react";
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { isStripeConfigured } from "@/server/billing/stripe";
import { listPromotionCodes } from "@/server/billing";
import { PAGE_SIZE, listSubscriptions } from "@/server/queries/admin-ops";
import { saveCreditPackAction, savePlanAction, saveSizeRulesAction, syncPlanStripeAction, togglePromoCodeAction } from "@/server/actions/admin/ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { ActionButton, ActionDialog } from "@/components/shared/action-dialog";
import { CheckboxField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FilterSelect, Pagination } from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerLink, Notice } from "@/components/admin/ops/ui";
import { PromoCodeForm } from "@/components/admin/ops/client";
import { SUBSCRIPTION_STATUS } from "@/lib/labels";
import { formatDate, formatMoney } from "@/lib/format";
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
  const stripe = isStripeConfigured();
  const [plans, rules, packs, subs, promos] = await Promise.all([
    db.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } } } } } } }),
    db.parcelSizeRule.findMany({ orderBy: { sortOrder: "asc" } }),
    db.creditPack.findMany({ orderBy: { sortOrder: "asc" } }),
    listSubscriptions({ status, page }),
    stripe ? listPromotionCodes(actor).catch(() => "error" as const) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title="Abonnements et offres" description="Offres commerciales, coût des catégories de colis, recharges, codes promotionnels et abonnements en cours." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenu mensuel récurrent" value={formatMoney(subs.kpis.mrrCents)} icon={BadgeEuro} tone="brand" hint="Abonnements actifs à jour" />
        <StatCard label="Abonnements actifs" value={subs.kpis.active} icon={CreditCard} tone="success" />
        <StatCard label="Impayés" value={subs.kpis.pastDue} icon={CircleAlert} tone={subs.kpis.pastDue ? "danger" : "default"} href="/admin/paiements?onglet=echecs" />
        <StatCard label="Résiliations programmées" value={subs.kpis.cancelScheduled} icon={CalendarX2} tone={subs.kpis.cancelScheduled ? "warning" : "default"} />
      </div>

      {!stripe && (
        <Notice className="mb-6">
          Stripe n&apos;est pas configuré{env.billingMode === "dev" ? " — mode de paiement de démonstration actif (aucun encaissement)" : ""}. Les offres restent modifiables ; la synchronisation des prix et les codes promotionnels nécessitent <code>STRIPE_SECRET_KEY</code>.
        </Notice>
      )}

      <div className="space-y-6">
        <Section
          title="Offres"
          description="Paramètres modifiables : prix, crédits mensuels, limite de stockage et contenu affiché sur le site. Une modification de prix crée un nouveau prix Stripe ; les abonnés existants conservent leur tarif jusqu'à migration."
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
                      <TextField name="price" label="Prix mensuel (€ TTC)" defaultValue={euros(p.priceCents)} inputMode="decimal" required />
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
                    <SubmitButton pendingLabel="Enregistrement…">Enregistrer l&apos;offre</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-sm">
                    {formatMoney(p.priceCents)} / mois · {p.monthlyCredits} crédits · stockage {p.storageLimit ?? "illimité"}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate font-mono">{p.stripePriceId ?? "Aucun prix Stripe"}</span>
                  {canEdit && stripe && (
                    <ActionButton action={syncPlanStripeAction} fields={{ planId: p.id }} variant="outline" size="xs">
                      <RefreshCw /> Synchroniser avec Stripe
                    </ActionButton>
                  )}
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
          title="Recharges de crédits"
          description="Packs achetables ponctuellement par les clients abonnés. Leur politique d'expiration se règle dans Crédits."
          actions={
            canEdit && (
              <ActionDialog trigger={<Button size="sm">Nouvelle recharge</Button>} title="Nouvelle recharge" action={saveCreditPackAction} submitLabel="Créer">
                <PackFields />
              </ActionDialog>
            )
          }
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
                    Aucune recharge configurée.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Section>

        <Section title="Codes promotionnels" description="Créés dans Stripe et utilisables lors du paiement (abonnement et recharges).">
          {!stripe ? (
            <p className="text-sm text-muted-foreground">Disponible lorsque Stripe est configuré.</p>
          ) : promos === "error" ? (
            <p className="text-sm text-danger">Impossible de joindre Stripe pour lister les codes. Réessayez plus tard.</p>
          ) : (
            <div className="grid gap-6">
              {canEdit && <PromoCodeForm />}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Remise</TableHead>
                    <TableHead>Durée</TableHead>
                    <TableHead className="text-right">Utilisations</TableHead>
                    <TableHead>Expire</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(promos ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono font-medium">{c.code}</TableCell>
                      <TableCell>{c.percentOff ? `${c.percentOff} %` : c.amountOff ? formatMoney(c.amountOff) : "—"}</TableCell>
                      <TableCell>{c.duration === "once" ? "1er paiement" : c.duration === "forever" ? "Permanente" : "Plusieurs mois"}</TableCell>
                      <TableCell className="text-right tabular">
                        {c.timesRedeemed}
                        {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}
                      </TableCell>
                      <TableCell>{c.expiresAt ? formatDate(c.expiresAt) : "—"}</TableCell>
                      <TableCell>
                        <StatusBadge tone={c.active ? "success" : "neutral"} label={c.active ? "Actif" : "Inactif"} />
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit && (
                          <ActionButton action={togglePromoCodeAction} fields={{ id: c.id, active: String(!c.active) }} variant="ghost" size="sm">
                            {c.active ? "Désactiver" : "Réactiver"}
                          </ActionButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {promos && promos.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        Aucun code promotionnel.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
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
                    <span className="block text-xs text-muted-foreground">{formatMoney(s.plan.priceCents, s.plan.currency)} / mois</span>
                  </TableCell>
                  <TableCell>
                    <StatusFrom map={SUBSCRIPTION_STATUS} value={s.status} />
                  </TableCell>
                  <TableCell>{formatDate(s.currentPeriodEnd)}</TableCell>
                  <TableCell>{s.status === "CANCELED" ? "—" : s.cancelAtPeriodEnd ? <StatusBadge tone="warning" label="Résiliation programmée" /> : "Automatique"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.provider === "dev" ? "Démonstration" : "Stripe"}</TableCell>
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
          Les clients gèrent leur moyen de paiement et téléchargent leurs factures depuis leur espace. Voir aussi <Link href="/admin/paiements" className="underline">Paiements</Link>.
        </p>
      </div>
    </>
  );
}

function PackFields({ pack }: { pack?: { name: string; credits: number; priceCents: number; isActive: boolean; sortOrder: number } }) {
  return (
    <>
      <TextField name="name" label="Nom" required defaultValue={pack?.name} placeholder="Recharge 10" />
      <div className="grid grid-cols-3 gap-3">
        <TextField name="credits" label="Crédits" type="number" min={1} required defaultValue={pack?.credits} />
        <TextField name="price" label="Prix (€ TTC)" required inputMode="decimal" defaultValue={pack ? euros(pack.priceCents) : ""} />
        <TextField name="sortOrder" label="Ordre" type="number" min={0} defaultValue={pack?.sortOrder ?? 0} required />
      </div>
      <CheckboxField name="isActive" label="Proposée aux clients" defaultChecked={pack?.isActive ?? true} />
    </>
  );
}
