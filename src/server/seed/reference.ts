import type { PrismaClient } from "@/generated/prisma/client";
import type { LocationType, OrderMode } from "@/generated/prisma/enums";
import { SYSTEM_ROLES } from "@/server/auth/permissions";

/**
 * Données de référence (valeurs initiales modifiables par l'administrateur).
 * Ce module est idempotent : il ne remplace jamais une valeur déjà éditée.
 */

/**
 * Prix : au moins 1,90 € le crédit en mensuel (Starter 2,45 €, Pro 2,38 €,
 * Business 2,24 €). Formule annuelle : 11 mois facturés, 1 mois offert.
 */
const plan = (code: string, name: string, tagline: string, priceCents: number, monthlyCredits: number, storageLimit: number, highlighted: boolean, sortOrder: number) => ({
  code,
  name,
  tagline,
  priceCents,
  annualPriceCents: priceCents * 11,
  monthlyCredits,
  storageLimit,
  highlighted,
  sortOrder,
  features: [
    `${monthlyCredits} crédits de préparation par mois`,
    "Préparateur de commandes attitré",
    `${storageLimit} articles en stock en même temps`,
    "Colis expédiés sous 48 h",
    "Suivi des commandes, du stock et des expéditions",
    "Messagerie directe avec votre préparateur",
  ],
});

export const DEFAULT_PLANS = [
  plan("STARTER", "Starter", "Pour lancer votre activité sans gérer un seul colis.", 4900, 20, 5, false, 1),
  plan("PRO", "Pro", "Pour les vendeurs réguliers qui expédient chaque semaine.", 9500, 40, 10, true, 2),
  plan("BUSINESS", "Business", "Pour les boutiques à fort volume.", 17900, 80, 20, false, 3),
];

export const DEFAULT_SIZE_RULES = [
  { size: "SMALL" as const, label: "Petit colis", description: "Vêtement plié, accessoire, petit objet.", creditCost: 1, maxLengthCm: 35, maxWidthCm: 25, maxHeightCm: 10, maxWeightGrams: 1000, sortOrder: 0 },
  { size: "MEDIUM" as const, label: "Moyen colis", description: "Chaussures, plusieurs vêtements, petit électronique.", creditCost: 2, maxLengthCm: 45, maxWidthCm: 35, maxHeightCm: 20, maxWeightGrams: 5000, sortOrder: 1 },
  { size: "LARGE" as const, label: "Grand colis", description: "Manteaux, lots, objets volumineux.", creditCost: 3, maxLengthCm: 70, maxWidthCm: 50, maxHeightCm: 50, maxWeightGrams: 20000, sortOrder: 2 },
];

/** Recharges de crédits supplémentaires : 10, 30, 50 ou 100 (prix modifiables par l'admin). */
/**
 * Recharges : le crédit acheté en plus coûte au moins autant qu'un crédit
 * inclus dans l'offre Starter (2,45 €), de 2,99 € à 2,49 € selon la quantité.
 */
export const DEFAULT_CREDIT_PACKS = [
  { name: "10 crédits", credits: 10, priceCents: 2990, sortOrder: 1 },
  { name: "30 crédits", credits: 30, priceCents: 8490, sortOrder: 2 },
  { name: "50 crédits", credits: 50, priceCents: 13490, sortOrder: 3 },
  { name: "100 crédits", credits: 100, priceCents: 24900, sortOrder: 4 },
];

const ALL: LocationType[] = ["BUSINESS_ADDRESS", "LOCKER", "RELAY_POINT", "POST_OFFICE"];
/** Vinted : livraison en point relais / locker (ou adresse), pas en poste restante. */
const PICKUPS: LocationType[] = ["BUSINESS_ADDRESS", "LOCKER", "RELAY_POINT"];
/** Commandes pour le stock : ZenMarket, Vinted, Vestiaire Collective. Dropshipping : Temu, SHEIN, AliExpress. */
const STOCK: OrderMode[] = ["STOCK"];
const DROPSHIP: OrderMode[] = ["DROPSHIP"];

/**
 * Compatibilités par défaut, volontairement prudentes. Elles doivent être
 * vérifiées et ajustées par l'administrateur selon les options réellement
 * proposées par chaque fournisseur au moment de l'achat.
 */
/** ZenMarket : poste japonaise remise à La Poste, donc poste restante possible (pas DHL ni FedEx). */
export const ZENMARKET_NOTES =
  "Choisissez un envoi par la poste japonaise (EMS, ePacket ou courrier aérien) : il est livré en France par La Poste, en poste restante au bureau de poste de votre préparateur, avec le nom du destinataire indiqué. DHL et FedEx ne livrent pas en poste restante : dans ce cas, utilisez uniquement une adresse de domiciliation.";

export const DEFAULT_SUPPLIERS = [
  {
    code: "VINTED",
    name: "Vinted",
    websiteUrl: "https://www.vinted.fr",
    acceptedLocationTypes: PICKUPS,
    acceptedNetworks: ["MONDIAL_RELAY", "INPOST", "RELAIS_COLIS", "VINTED_GO", "CHRONOPOST_PICKUP"],
    requiresPickupCode: true,
    orderModes: STOCK,
    sortOrder: 2,
    compatibilityNotes:
      "Les modes de livraison proposés dépendent du vendeur et du pays. Choisissez au paiement le point relais ou le locker de votre préparateur, avec le nom de destinataire et le numéro de téléphone indiqués : votre préparateur reçoit ainsi le SMS avec le code de retrait.",
  },
  {
    code: "ZENMARKET",
    name: "ZenMarket",
    websiteUrl: "https://zenmarket.jp/fr/",
    acceptedLocationTypes: ["POST_OFFICE", "BUSINESS_ADDRESS"] as LocationType[],
    acceptedNetworks: [],
    requiresPickupCode: false,
    orderModes: STOCK,
    sortOrder: 1,
    compatibilityNotes: ZENMARKET_NOTES,
  },
  {
    code: "VESTIAIRE",
    name: "Vestiaire Collective",
    websiteUrl: "https://fr.vestiairecollective.com",
    acceptedLocationTypes: ["BUSINESS_ADDRESS"] as LocationType[],
    acceptedNetworks: [],
    requiresPickupCode: false,
    orderModes: STOCK,
    sortOrder: 3,
    compatibilityNotes:
      "Livraison à l'adresse de domiciliation de votre préparateur (nom du destinataire et code client indiqués dans votre espace). Les options de point relais varient selon la commande : vérifiez-les au paiement.",
  },
  {
    code: "TEMU",
    name: "Temu",
    websiteUrl: "https://www.temu.com/fr",
    acceptedLocationTypes: ["BUSINESS_ADDRESS"] as LocationType[],
    acceptedNetworks: [],
    requiresPickupCode: false,
    orderModes: DROPSHIP,
    sortOrder: 5,
    compatibilityNotes: "Livraison à l'adresse de domiciliation de votre préparateur. Les délais de livraison varient : tenez-en compte dans le délai annoncé à votre acheteur.",
  },
  {
    code: "SHEIN",
    name: "SHEIN",
    websiteUrl: "https://fr.shein.com",
    acceptedLocationTypes: ["BUSINESS_ADDRESS", "RELAY_POINT"] as LocationType[],
    acceptedNetworks: ["MONDIAL_RELAY", "RELAIS_COLIS"],
    requiresPickupCode: false,
    orderModes: DROPSHIP,
    sortOrder: 6,
    compatibilityNotes: "La livraison en point relais n'est pas proposée pour toutes les commandes : vérifiez l'option au moment du paiement.",
  },
  {
    code: "ALIEXPRESS",
    name: "AliExpress",
    websiteUrl: "https://fr.aliexpress.com",
    acceptedLocationTypes: ["BUSINESS_ADDRESS"] as LocationType[],
    acceptedNetworks: [],
    requiresPickupCode: false,
    orderModes: DROPSHIP,
    sortOrder: 7,
    compatibilityNotes: "Livraison à l'adresse de domiciliation du préparateur recommandée. Les options de retrait varient selon le vendeur et ne sont pas activées par défaut.",
  },
  {
    code: "WHATNOT",
    name: "Whatnot",
    websiteUrl: "https://www.whatnot.com/fr-FR",
    acceptedLocationTypes: ALL,
    acceptedNetworks: ["MONDIAL_RELAY", "INPOST", "RELAIS_COLIS", "CHRONOPOST_PICKUP", "LA_POSTE", "OTHER"],
    requiresPickupCode: false,
    orderModes: STOCK,
    sortOrder: 4,
    compatibilityNotes:
      "Achats en direct (enchères et ventes en live). Les modes de livraison dépendent du vendeur : indiquez au paiement l'adresse ou le point de retrait de votre préparateur, avec le nom de destinataire et votre code client.",
  },
  {
    code: "OTHER",
    name: "Autre fournisseur",
    websiteUrl: null,
    acceptedLocationTypes: ALL,
    acceptedNetworks: ["MONDIAL_RELAY", "INPOST", "RELAIS_COLIS", "VINTED_GO", "CHRONOPOST_PICKUP", "LA_POSTE", "UPS_ACCESS_POINT", "DPD_PICKUP", "GLS_RELAY", "AMAZON_LOCKER", "OTHER"],
    requiresPickupCode: false,
    /** « Autre » : le client précise où il a acheté l'article (stock ou dropshipping). */
    orderModes: ["STOCK", "DROPSHIP"] as OrderMode[],
    sortOrder: 99,
    compatibilityNotes: "Vous devez confirmer que la boutique livre bien vers le point de réception choisi.",
  },
];

export async function seedReferenceData(db: PrismaClient) {
  for (const role of SYSTEM_ROLES) {
    await db.role.upsert({
      where: { key: role.key },
      create: { key: role.key, name: role.name, description: role.description, permissions: [...role.permissions], isSystem: true },
      update: role.key === "super_admin" ? { permissions: ["*"], isSystem: true } : {},
    });
  }
  for (const plan of DEFAULT_PLANS) {
    await db.plan.upsert({ where: { code: plan.code }, create: plan, update: {} });
  }
  for (const rule of DEFAULT_SIZE_RULES) {
    await db.parcelSizeRule.upsert({ where: { size: rule.size }, create: rule, update: {} });
  }
  // Recharges : exactement 10, 30, 50 et 100 crédits. Les prix déjà réglés sont
  // conservés ; toute autre quantité est désactivée.
  for (const pack of DEFAULT_CREDIT_PACKS) {
    const existing = await db.creditPack.findFirst({ where: { credits: pack.credits } });
    if (!existing) await db.creditPack.create({ data: pack });
  }
  await db.creditPack.updateMany({ where: { credits: { notIn: DEFAULT_CREDIT_PACKS.map((p) => p.credits) } }, data: { isActive: false } });
  for (const s of DEFAULT_SUPPLIERS) {
    await db.supplier.upsert({ where: { code: s.code }, create: s, update: {} });
  }
}
