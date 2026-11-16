/**
 * PACKIO — Données de démonstration (DÉVELOPPEMENT UNIQUEMENT)
 *
 * Toutes les données créées ici sont clairement identifiées :
 *  - adresses e-mail en @demo.packio.local
 *  - champ users.isDemo = true (badge « Démo » dans le back-office)
 *  - bandeau « Environnement de démonstration » dans l'application
 *
 * Le script refuse de s'exécuter en production.
 */
import "dotenv/config";
import { addDays, addHours, subHours } from "date-fns";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { toActor } from "@/server/auth/session-store";
import { hashPassword } from "@/server/auth/password";
import { seedReferenceData } from "@/server/seed/reference";
import { createPreparer, saveLocation, setPreparerStatus } from "@/server/services/preparers";
import { registerCustomer } from "@/server/services/auth";
import { withEffects } from "@/server/services/notifications";
import { onInvoicePaid, syncSubscription } from "@/server/services/billing";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, customerUpdateOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import { classifyShipment, confirmDropOff, confirmLabel, markReady, requestShipment, startPreparation, updateTransit } from "@/server/services/shipments";
import { sendMessage } from "@/server/services/messaging";
import { syncFromExtension } from "@/server/services/marketplace";
import { randomCode } from "@/server/lib/ids";

const DEMO_DOMAIN = "demo.packio.local";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo-Packio-2026";

function guard() {
  // DEMO_DATA=1 : déploiement de démonstration assumé (ex. Render, voir README).
  const demoDeployment = process.env.DEMO_DATA === "1";
  if (process.env.NODE_ENV === "production" && !demoDeployment) {
    throw new Error("Refus : les données de démonstration ne doivent jamais être créées en production (DEMO_DATA=1 pour un site de démonstration).");
  }
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|@db:|@postgres:/.test(url) && process.env.SEED_ALLOW_REMOTE !== "1" && !demoDeployment) {
    throw new Error("Refus : base distante détectée. Définissez SEED_ALLOW_REMOTE=1 si cette base est bien une base de développement.");
  }
}

async function demoMarketplaceSales(customerId: string, figurineSku: string) {
  await syncFromExtension(customerId, {
    platform: "VINTED",
    account: { externalUserId: "demo-lea-vinted", username: "lea.vintage (démo)" },
    listings: [
      { externalId: "DEMO-L-1", title: "Figurine One Piece édition limitée", description: `Neuve, jamais déballée. Réf. ${figurineSku}`, priceCents: 4500, status: "active" },
      { externalId: "DEMO-L-2", title: "Pull en laine beige — M", priceCents: 1800, status: "active" },
      { externalId: "DEMO-L-3", title: "Sac à main en cuir noir", priceCents: 3500, status: "active" },
    ],
    sales: [
      { externalOrderId: "DEMO-VT-5001", externalItemId: "DEMO-L-1", title: "Figurine One Piece édition limitée", priceCents: 4500, buyerName: "Sarah B. (démo)", soldAt: subHours(new Date(), 5) },
      { externalOrderId: "DEMO-VT-5002", externalItemId: "DEMO-L-2", title: "Pull en laine beige — M", priceCents: 1800, buyerName: "Thomas L. (démo)", soldAt: subHours(new Date(), 26) },
      { externalOrderId: "DEMO-VT-5003", externalItemId: "DEMO-L-3", title: "Sac à main en cuir noir", priceCents: 3500, buyerName: "Inès M. (démo)", soldAt: subHours(new Date(), 50) },
    ],
  });
}

async function actorFor(userId: string): Promise<Actor> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { staffRole: true, customerProfile: { select: { id: true } }, preparerProfile: { select: { id: true } } },
  });
  return toActor(user);
}

async function markDemo(userId: string) {
  await db.user.update({ where: { id: userId }, data: { isDemo: true, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() } });
}

async function subscribe(customerId: string, planCode: string, startedAt: Date, interval: "MONTHLY" | "YEARLY" = "MONTHLY") {
  const plan = await db.plan.findUniqueOrThrow({ where: { code: planCode } });
  const externalId = `dev_mem_${randomCode(14)}`;
  const end = addDays(startedAt, interval === "YEARLY" ? 365 : 30);
  const price = interval === "YEARLY" ? (plan.annualPriceCents ?? plan.priceCents * 10) : plan.priceCents;
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId: plan.id, provider: "dev", externalId, status: "ACTIVE", periodStart: startedAt, periodEnd: end, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, billingInterval: interval });
    await onInvoicePaid(tx, fx, {
      externalId: `dev_pay_${randomCode(14)}`,
      customerId,
      subscriptionExternalId: externalId,
      number: `DEMO-${randomCode(6)}`,
      status: "paid",
      billingReason: "subscription_create",
      amountDueCents: price,
      amountPaidCents: price,
      currency: plan.currency,
      hostedUrl: null,
      pdfUrl: null,
      periodStart: startedAt,
      periodEnd: end,
      issuedAt: startedAt,
      planId: plan.id,
      membershipId: externalId,
      provider: "dev",
    });
  });
  const { slaHours } = { slaHours: 24 };
  await db.customerProfile.update({ where: { id: customerId }, data: { assignmentRequestedAt: startedAt, assignmentDueAt: addHours(startedAt, slaHours) } });
}

async function main() {
  guard();
  console.log("→ Données de référence");
  await seedReferenceData(db);

  if (await db.user.findFirst({ where: { email: { endsWith: `@${DEMO_DOMAIN}` } } })) {
    console.log("✓ Les données de démonstration existent déjà (aucune modification).");
    return;
  }

  console.log("→ Administrateur de démonstration");
  const superRole = await db.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  const adminUser = await db.user.create({
    data: { email: `admin@${DEMO_DOMAIN}`, role: "ADMIN", staffRoleId: superRole.id, firstName: "Inès", lastName: "Lambert" },
  });
  await markDemo(adminUser.id);
  const admin = await actorFor(adminUser.id);

  console.log("→ Préparateurs");
  const camille = await createPreparer(admin, {
    firstName: "Camille",
    lastName: "Martin",
    email: `camille.martin@${DEMO_DOMAIN}`,
    phone: "+33 6 00 00 00 01",
    city: "Lyon",
    country: "FR",
    businessAddressLine1: "18 rue Garibaldi",
    businessPostalCode: "69006",
    businessCity: "Lyon",
    compatibleCarriers: ["COLISSIMO", "MONDIAL_RELAY", "INPOST", "CHRONOPOST", "VINTED_GO"],
    storageCapacity: 800,
    maxClients: 15,
    availabilityNote: "Dépôts transporteurs chaque jour à 17 h.",
    adminNotes: "Préparatrice de démonstration.",
  });
  await markDemo(camille.preparer.userId);
  const camilleBusiness = await saveLocation(admin, {
    preparerId: camille.preparer.id, type: "BUSINESS_ADDRESS", label: "Adresse professionnelle", addressLine1: "18 rue Garibaldi", postalCode: "69006", city: "Lyon", country: "FR", recipientName: "Camille Martin", isPrimary: false, validate: true,
    instructions: "Indiquez votre code client Packio en complément d'adresse.",
  });
  const camilleLocker = await saveLocation(admin, {
    preparerId: camille.preparer.id, type: "LOCKER", label: "Locker principal", network: "INPOST", relayName: "InPost Lyon Brotteaux (démo)", externalId: "DEMO-LYO-001",
    addressLine1: "2 place Jules Ferry", postalCode: "69006", city: "Lyon", country: "FR", recipientName: "Camille Martin", isPrimary: true, validate: true, openingHours: "24 h/24, 7 j/7",
  });
  await saveLocation(admin, {
    preparerId: camille.preparer.id, type: "RELAY_POINT", label: "Point relais secondaire", network: "MONDIAL_RELAY", relayName: "Relais démo Part-Dieu", externalId: "DEMO-MR-042",
    addressLine1: "40 rue Servient", postalCode: "69003", city: "Lyon", country: "FR", recipientName: "Camille Martin", isPrimary: false, validate: false,
  });

  const yanis = await createPreparer(admin, {
    firstName: "Yanis", lastName: "Benali", email: `yanis.benali@${DEMO_DOMAIN}`, phone: "+33 6 00 00 00 02", city: "Lille", country: "FR",
    businessAddressLine1: "7 rue Nationale", businessPostalCode: "59000", businessCity: "Lille", compatibleCarriers: ["COLISSIMO", "MONDIAL_RELAY", "DPD", "UPS"],
    storageCapacity: 400, maxClients: 8,
  });
  await markDemo(yanis.preparer.userId);
  await saveLocation(admin, {
    preparerId: yanis.preparer.id, type: "LOCKER", label: "Locker principal", network: "MONDIAL_RELAY", relayName: "Locker Mondial Relay Lille Centre (démo)", externalId: "DEMO-LIL-007",
    addressLine1: "1 place de la Gare", postalCode: "59000", city: "Lille", country: "FR", recipientName: "Yanis Benali", isPrimary: true, validate: true,
  });
  await saveLocation(admin, {
    preparerId: yanis.preparer.id, type: "BUSINESS_ADDRESS", label: "Adresse professionnelle", addressLine1: "7 rue Nationale", postalCode: "59000", city: "Lille", country: "FR", recipientName: "Yanis Benali", isPrimary: false, validate: true,
  });

  const sofia = await createPreparer(admin, {
    firstName: "Sofia", lastName: "Ricci", email: `sofia.ricci@${DEMO_DOMAIN}`, city: "Marseille", country: "FR", compatibleCarriers: ["COLISSIMO"], storageCapacity: 200, maxClients: 5,
  });
  await markDemo(sofia.preparer.userId);
  await setPreparerStatus(admin, { preparerId: sofia.preparer.id, status: "UNAVAILABLE", reason: "Congés (démo)" });

  console.log("→ Clients");
  const lea = await registerCustomer({ firstName: "Léa", lastName: "Moreau", email: `lea.moreau@${DEMO_DOMAIN}`, password: PASSWORD, companyName: "Léa Vintage" });
  await markDemo(lea.id);
  await subscribe(lea.customerProfile!.id, "PRO", subHours(new Date(), 24 * 12));
  await assignPreparer(admin, { customerId: lea.customerProfile!.id, preparerId: camille.preparer.id, note: "Même ville que la cliente." });
  const leaActor = await actorFor(lea.id);
  const camilleActor = await actorFor(camille.preparer.userId);

  const vinted = await db.supplier.findUniqueOrThrow({ where: { code: "VINTED" } });
  const zen = await db.supplier.findUniqueOrThrow({ where: { code: "ZENMARKET" } });
  const shein = await db.supplier.findUniqueOrThrow({ where: { code: "SHEIN" } });

  // Commande déjà en stock
  const o1 = await createSupplierOrder(leaActor, { supplierId: vinted.id, locationId: camilleLocker.id, description: "Veste en jean Levi's taille M", quantity: 1, supplierOrderNumber: "VT-DEMO-1001", trackingNumber: "DEMO000000001", carrier: "INPOST" });
  await customerUpdateOrder(leaActor, { orderId: o1.id, status: "AT_LOCKER", pickupCode: "482913" });
  await markPickedUp(camilleActor, { orderId: o1.id });
  await receiveOrder(camilleActor, { orderId: o1.id, quantityReceived: 1, conditionOk: true, conditionNotes: "Très bon état" });
  const s1 = await stockOrder(camilleActor, { orderId: o1.id, items: [{ name: "Veste en jean Levi's (M)", quantity: 1, storageLocation: "A-03" }] });

  const o2 = await createSupplierOrder(leaActor, { supplierId: zen.id, locationId: camilleBusiness.id, description: "Figurines One Piece, édition limitée", quantity: 2, trackingNumber: "EMDEMO0000002JP", carrier: "LA_POSTE" });
  await markPickedUp(camilleActor, { orderId: o2.id });
  await receiveOrder(camilleActor, { orderId: o2.id, quantityReceived: 2, conditionOk: true });
  const s2 = await stockOrder(camilleActor, { orderId: o2.id, items: [{ name: "Figurine One Piece (édition limitée)", quantity: 2, storageLocation: "B-11" }] });

  const o3 = await createSupplierOrder(leaActor, { supplierId: vinted.id, locationId: camilleLocker.id, description: "Sneakers Nike Air Max 90 — 39", quantity: 1, carrier: "INPOST", trackingNumber: "DEMO000000003" });
  await markPickedUp(camilleActor, { orderId: o3.id });
  await receiveOrder(camilleActor, { orderId: o3.id, quantityReceived: 1, conditionOk: true });
  const s3 = await stockOrder(camilleActor, { orderId: o3.id, items: [{ name: "Nike Air Max 90 (39)", quantity: 1, storageLocation: "C-01" }] });

  // Commandes en cours d'acheminement
  // Dropshipping : robe déjà vendue sur Vinted, expédiée à l'acheteuse dès réception.
  await createSupplierOrder(leaActor, {
    supplierId: shein.id,
    locationId: camilleBusiness.id,
    description: "Robe midi fleurie — S",
    quantity: 1,
    expectedArrivalAt: addDays(new Date(), 4),
    mode: "DROPSHIP",
    salePlatform: "VINTED",
    saleReference: "VT-DEMO-2042",
    buyerName: "Camille Roy",
    buyerAddressLine1: "18 rue Sainte-Catherine",
    buyerPostalCode: "33000",
    buyerCity: "Bordeaux",
    buyerCountry: "FR",
  });
  const o5 = await createSupplierOrder(leaActor, { supplierId: vinted.id, locationId: camilleLocker.id, description: "Sac Longchamp Le Pliage", quantity: 1 });
  await customerUpdateOrder(leaActor, { orderId: o5.id, trackingNumber: "DEMO000000005", carrier: "INPOST" });

  // Expédition livrée
  const e1 = await requestShipment(leaActor, {
    items: [{ itemId: s1.items[0].id, quantity: 1 }], recipientName: "Julie Fontaine", addressLine1: "12 rue des Lilas", postalCode: "75020", city: "Paris", country: "FR", labelMode: "PREPARER_PROVIDED", requestedCarrier: "COLISSIMO", options: ["REINFORCED"],
  });
  await classifyShipment(camilleActor, { shipmentId: e1.id, size: "MEDIUM", weightGrams: 900 });
  await startPreparation(camilleActor, { shipmentId: e1.id });
  await markReady(camilleActor, { shipmentId: e1.id });
  const label = await db.file.create({
    data: { storageKey: `demo/${e1.id}-etiquette.pdf`, filename: "etiquette-demo.pdf", mimeType: "application/pdf", sizeBytes: 0, sha256: "demo", purpose: "SHIPPING_LABEL", uploadedById: camille.preparer.userId },
  });
  await confirmLabel(camilleActor, { shipmentId: e1.id, labelFileId: label.id });
  await confirmDropOff(camilleActor, { shipmentId: e1.id, carrier: "COLISSIMO", trackingNumber: "6ADEMO0000001" });
  await updateTransit(camilleActor, { shipmentId: e1.id, status: "IN_TRANSIT" });
  await updateTransit(camilleActor, { shipmentId: e1.id, status: "DELIVERED" });

  // Expédition en attente de classification
  await requestShipment(leaActor, {
    items: [{ itemId: s3.items[0].id, quantity: 1 }], recipientName: "Marc Dubois", addressLine1: "3 allée des Pins", postalCode: "33000", city: "Bordeaux", country: "FR", labelMode: "PREPARER_PROVIDED", requestedCarrier: "MONDIAL_RELAY", instructions: "Double carton si possible, merci !",
  });

  // Ventes Vinted remontées par Packio Connect (données fictives) : la figurine,
  // dont l'annonce cite le SKU, part seule chez la préparatrice ; les deux autres
  // ventes attendent « Vendu avec Packio » ou « Supprimer ».
  await demoMarketplaceSales(lea.customerProfile!.id, s2.items[0].sku);

  const conversation = await db.conversation.findFirstOrThrow({ where: { customerId: lea.customerProfile!.id, preparerId: camille.preparer.id } });
  await sendMessage(leaActor, { conversationId: conversation.id, body: "Bonjour Camille ! J'ai une paire de Nike qui arrive au locker cette semaine." });
  await sendMessage(camilleActor, { conversationId: conversation.id, body: "Bonjour Léa, bien reçu. Je la récupère dès sa disponibilité et je vous envoie les photos." });

  // Client en attente d'attribution (5 h)
  const hugo = await registerCustomer({ firstName: "Hugo", lastName: "Petit", email: `hugo.petit@${DEMO_DOMAIN}`, password: PASSWORD });
  await markDemo(hugo.id);
  await subscribe(hugo.customerProfile!.id, "STARTER", subHours(new Date(), 5));

  // Client en retard d'attribution (26 h)
  const nina = await registerCustomer({ firstName: "Nina", lastName: "Garnier", email: `nina.garnier@${DEMO_DOMAIN}`, password: PASSWORD, companyName: "Garnier Shop" });
  await markDemo(nina.id);
  await subscribe(nina.customerProfile!.id, "BUSINESS", subHours(new Date(), 26), "YEARLY");

  // Compte créé sans paiement
  const tom = await registerCustomer({ firstName: "Tom", lastName: "Roux", email: `tom.roux@${DEMO_DOMAIN}`, password: PASSWORD });
  await markDemo(tom.id);

  console.log("\n✓ Données de démonstration créées. Mot de passe commun :", PASSWORD);
  console.log(`  Super admin   : admin@${DEMO_DOMAIN}`);
  console.log(`  Préparatrice  : camille.martin@${DEMO_DOMAIN}`);
  console.log(`  Client (Pro)  : lea.moreau@${DEMO_DOMAIN}`);
  console.log(`  En attente    : hugo.petit@${DEMO_DOMAIN}   ·   En retard : nina.garnier@${DEMO_DOMAIN}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
