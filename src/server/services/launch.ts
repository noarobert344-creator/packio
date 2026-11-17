import { addYears } from "date-fns";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { toActor } from "@/server/auth/session-store";
import { storage } from "@/server/storage";
import { audit } from "./audit";
import { enableAdminCustomerProfile } from "./auth";
import { assignPreparer } from "./assignments";
import { syncSubscription } from "./billing";
import { adminAdjustCredits } from "./credits";
import { withEffects } from "./notifications";
import { enableAdminPreparerProfile } from "./preparers";

/**
 * LANCEMENT RÉEL (une seule fois)
 * Avant le lancement, tout ce qui a été fait sur le site l'a été avec des
 * paiements simulés : comptes de démonstration, commandes, expéditions,
 * ventes, crédits… Le lancement efface ces données de test et garde :
 *  - les réglages (paramètres, informations légales, offres, fournisseurs) ;
 *  - les comptes qui ne sont pas des comptes de démonstration (administrateurs,
 *    préparateurs avec leurs points de réception, clients — remis « en attente
 *    de paiement », puisqu'aucun n'a réellement payé) ;
 *  - le journal d'audit des comptes réels.
 * Le propriétaire (INITIAL_ADMIN_EMAIL) reçoit ensuite un espace préparateur et
 * un espace client actif (abonnement interne offert, crédits offerts), attribué
 * à son propre espace préparateur.
 *
 * Garde-fous : refusé si un vrai paiement Whop existe, si Whop n'est pas
 * configuré, ou si le lancement a déjà eu lieu (mémorisé dans app_settings).
 */

export const LAUNCH_SETTING_KEY = "launch_reset";
const DEMO_USERS = `SELECT "id" FROM "users" WHERE "isDemo" = true AND "email" LIKE '%@demo.packio.local'`;
const LEDGERS = ["credit_transactions", "inventory_movements", "audit_logs", "shipment_events", "supplier_order_events"];
/** Crédits offerts au propriétaire (il peut en ajouter depuis Admin → Clients). */
export const OWNER_CREDITS = 1000;

export type LaunchReport = {
  alreadyDone: boolean;
  demoUsersDeleted: number;
  customersReset: number;
  filesDeleted: number;
  owner?: { preparerId: string; customerId: string; plan: string; credits: number; assigned: boolean; assignNote?: string };
};

export async function launchReset(opts: { ownerEmail: string; env?: Record<string, string | undefined> }): Promise<LaunchReport> {
  const env = opts.env ?? process.env;
  const done = await db.appSetting.findUnique({ where: { key: LAUNCH_SETTING_KEY } });
  if (done) return { alreadyDone: true, demoUsersDeleted: 0, customersReset: 0, filesDeleted: 0 };

  // Garde-fous : rien n'est effacé si l'un d'eux échoue.
  if (env.BILLING_MODE !== "whop") throw new DomainError("LAUNCH_BILLING", "Lancement refusé : BILLING_MODE doit valoir « whop ».");
  for (const key of ["WHOP_API_KEY", "WHOP_ACCOUNT_ID", "WHOP_WEBHOOK_SECRET"]) {
    if (!env[key]?.trim()) throw new DomainError("LAUNCH_WHOP", `Lancement refusé : ${key} n'est pas renseigné dans Render.`);
  }
  const realPayments = await db.payment.count({ where: { provider: "whop" } });
  if (realPayments > 0) throw new DomainError("LAUNCH_REAL_DATA", `Lancement refusé : ${realPayments} vrai(s) paiement(s) Whop existe(nt) déjà, aucune donnée n'est effacée.`);
  const owner = await db.user.findUnique({ where: { email: opts.ownerEmail.trim().toLowerCase() }, include: { staffRole: true } });
  if (!owner || owner.role !== "ADMIN" || owner.isDemo || !owner.passwordHash) {
    throw new DomainError("LAUNCH_OWNER", "Lancement refusé : le compte administrateur INITIAL_ADMIN_EMAIL est introuvable ou pas encore activé.");
  }

  // Fichiers à retirer du disque une fois l'effacement validé (tout sauf les photos de profil des comptes gardés).
  const keptAvatars = `SELECT "avatarFileId" FROM "users" WHERE "avatarFileId" IS NOT NULL AND "id" NOT IN (${DEMO_USERS})`;
  const files = await db.$queryRawUnsafe<{ storageKey: string }[]>(`SELECT "storageKey" FROM "files" WHERE "id" NOT IN (${keptAvatars})`);

  const counts = await db.$transaction(
    async (tx) => {
      const run = (sql: string) => tx.$executeRawUnsafe(sql);
      const demoUsers = (await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM (${DEMO_USERS}) d`))[0].n;
      // Registres en ajout seul : protection levée le temps de ce nettoyage unique,
      // dans la même transaction (rétablie à la fin, ou annulée avec elle en cas d'échec).
      for (const table of LEDGERS) await run(`ALTER TABLE "${table}" DISABLE TRIGGER "${table}_append_only"`);
      // Données d'activité (toutes de test avant le lancement).
      for (const table of ["marketplace_sale_lines", "marketplace_sales", "marketplace_listings", "ai_usages", "incident_updates", "incidents"]) {
        await run(`DELETE FROM "${table}"`);
      }
      const filesDeleted = await run(`DELETE FROM "files" WHERE "id" NOT IN (${keptAvatars})`);
      for (const table of [
        "messages",
        "conversations",
        "inventory_movements",
        "inventory_counts",
        "shipment_items",
        "shipment_events",
        "shipment_classifications",
        "credit_reservations",
        "credit_transactions",
        "credit_lots",
        "supplier_order_events",
        "inbound_parcels",
        "supplier_orders",
        "outbound_shipments",
        "inventory_items",
        "storage_purchases",
        "payments",
        "invoices",
        "subscriptions",
        "preparer_assignments",
        "notifications",
      ]) {
        await run(`DELETE FROM "${table}"`);
      }
      // Comptes de démonstration et ce qui leur est propre.
      const demoCustomers = `SELECT "id" FROM "customer_profiles" WHERE "userId" IN (${DEMO_USERS})`;
      const demoPreparers = `SELECT "id" FROM "preparer_profiles" WHERE "userId" IN (${DEMO_USERS})`;
      await run(`DELETE FROM "extension_tokens" WHERE "customerId" IN (${demoCustomers})`);
      await run(`DELETE FROM "marketplace_accounts" WHERE "customerId" IN (${demoCustomers})`);
      await run(`DELETE FROM "preparer_absences" WHERE "preparerId" IN (${demoPreparers}) OR "createdById" IN (${DEMO_USERS})`);
      await run(`DELETE FROM "audit_logs" WHERE "actorId" IN (${DEMO_USERS})`);
      await run(`DELETE FROM "email_logs" WHERE "toEmail" LIKE '%@demo.packio.local'`);
      await run(`DELETE FROM "credit_wallets" WHERE "customerId" IN (${demoCustomers})`);
      await run(`DELETE FROM "customer_profiles" WHERE "id" IN (${demoCustomers})`);
      await run(`DELETE FROM "preparer_profiles" WHERE "id" IN (${demoPreparers})`);
      // Photo de profil d'un compte gardé déposée par un compte de démonstration : rattachée au propriétaire.
      await run(`UPDATE "files" SET "uploadedById" = '${owner.id}' WHERE "uploadedById" IN (${DEMO_USERS})`);
      await run(`DELETE FROM "users" WHERE "id" IN (${DEMO_USERS})`);
      // Comptes clients réels : personne n'a encore payé, retour au point de départ.
      await run(`UPDATE "credit_wallets" SET "monthlyBalance" = 0, "purchasedBalance" = 0, "reservedBalance" = 0, "consumedTotal" = 0, "updatedAt" = CURRENT_TIMESTAMP`);
      for (const table of LEDGERS) await run(`ALTER TABLE "${table}" ENABLE TRIGGER "${table}_append_only"`);
      const customersReset = await run(
        `UPDATE "customer_profiles" SET "status" = 'PENDING_PAYMENT', "assignmentState" = 'NOT_REQUESTED', "assignmentRequestedAt" = NULL, "assignmentDueAt" = NULL,
         "assignmentAdminAlertedAt" = NULL, "assignmentDelayNotifiedAt" = NULL, "currentPreparerId" = NULL, "billingCustomerId" = NULL, "updatedAt" = CURRENT_TIMESTAMP`,
      );
      return { demoUsersDeleted: Number(demoUsers), customersReset, filesDeleted };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  for (const f of files) await storage().delete(f.storageKey).catch(() => undefined);

  // Espaces du propriétaire.
  const actor = toActor(
    await db.user.findUniqueOrThrow({ where: { id: owner.id }, include: { staffRole: true, customerProfile: { select: { id: true } }, preparerProfile: { select: { id: true } } } }),
  );
  const preparer = await enableAdminPreparerProfile(actor);
  await db.preparerProfile.update({ where: { id: preparer.id }, data: { status: "ACTIVE" } });
  const customer = await enableAdminCustomerProfile(actor);
  const plan = await db.plan.findFirstOrThrow({ where: { isActive: true }, orderBy: [{ monthlyCredits: "desc" }, { sortOrder: "desc" }] });
  const profile = await db.customerProfile.findUniqueOrThrow({ where: { id: customer.id }, select: { referenceCode: true } });
  const now = new Date();
  await withEffects((tx, fx) =>
    syncSubscription(tx, fx, {
      customerId: customer.id,
      planId: plan.id,
      // Abonnement interne du propriétaire : jamais facturé, jamais envoyé à Whop.
      provider: "dev",
      externalId: `interne_${profile.referenceCode}`,
      status: "ACTIVE",
      periodStart: now,
      periodEnd: addYears(now, 100),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      billingInterval: "MONTHLY",
    }),
  );
  const ownerActor = toActor(
    await db.user.findUniqueOrThrow({ where: { id: owner.id }, include: { staffRole: true, customerProfile: { select: { id: true } }, preparerProfile: { select: { id: true } } } }),
  );
  await adminAdjustCredits(ownerActor, {
    customerId: customer.id,
    direction: "CREDIT",
    amount: OWNER_CREDITS,
    bucket: "PURCHASED",
    reason: "Compte du fondateur : crédits offerts au lancement",
    expiresAt: null,
    requestId: `launch-${customer.id}`,
  });
  let assigned = false;
  let assignNote: string | undefined;
  try {
    await assignPreparer(ownerActor, { customerId: customer.id, preparerId: preparer.id, note: "Compte du fondateur" });
    assigned = true;
  } catch (err) {
    // Le plus souvent : aucun point de réception validé encore. L'attribution se fera depuis l'administration.
    assignNote = err instanceof Error ? err.message : String(err);
  }

  await db.appSetting.create({ data: { key: LAUNCH_SETTING_KEY, value: { at: now.toISOString(), ...counts }, updatedById: owner.id } });
  await audit({
    actor: ownerActor,
    action: "launch.reset",
    entityType: "app",
    entityId: LAUNCH_SETTING_KEY,
    summary: `Lancement : ${counts.demoUsersDeleted} compte(s) de démonstration et données de test effacés`,
    metadata: counts,
  });
  return {
    alreadyDone: false,
    ...counts,
    owner: { preparerId: preparer.id, customerId: customer.id, plan: plan.name, credits: OWNER_CREDITS, assigned, assignNote },
  };
}
