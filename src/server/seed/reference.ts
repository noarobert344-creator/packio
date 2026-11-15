import type { PrismaClient } from "@/generated/prisma/client";
import type { LocationType } from "@/generated/prisma/enums";
import { SYSTEM_ROLES } from "@/server/auth/permissions";

/**
 * Données de référence (valeurs initiales modifiables par l'administrateur).
 * Ce module est idempotent : il ne remplace jamais une valeur déjà éditée.
 */

/** Formule annuelle : 10 mois facturés, 2 mois offerts. */
export const DEFAULT_PLANS = [
  {
    code: "STARTER",
    name: "Starter",
    tagline: "Pour lancer votre activité sans gérer un seul colis.",
    priceCents: 2990,
    annualPriceCents: 29900,
    monthlyCredits: 20,
    storageLimit: 50,
    highlighted: false,
    sortOrder: 1,
    features: [
      "20 crédits de préparation par mois",
      "Préparateur de commandes attitré",
      "Stockage jusqu'à 50 articles",
      "Suivi des commandes, du stock et des expéditions",
      "Messagerie directe avec votre préparateur",
    ],
  },
  {
    code: "PRO",
    name: "Pro",
    tagline: "Pour les vendeurs réguliers qui expédient chaque semaine.",
    priceCents: 6990,
    annualPriceCents: 69900,
    monthlyCredits: 55,
    storageLimit: 200,
    highlighted: true,
    sortOrder: 2,
    features: [
      "55 crédits de préparation par mois",
      "Préparateur de commandes attitré",
      "Stockage jusqu'à 200 articles",
      "Suivi des commandes, du stock et des expéditions",
      "Messagerie directe avec votre préparateur",
    ],
  },
  {
    code: "BUSINESS",
    name: "Business",
    tagline: "Pour les boutiques à fort volume.",
    priceCents: 12990,
    annualPriceCents: 129900,
    monthlyCredits: 120,
    storageLimit: 600,
    highlighted: false,
    sortOrder: 3,
    features: [
      "120 crédits de préparation par mois",
      "Préparateur de commandes attitré",
      "Stockage jusqu'à 600 articles",
      "Suivi des commandes, du stock et des expéditions",
      "Messagerie directe avec votre préparateur",
    ],
  },
] as const;

export const DEFAULT_SIZE_RULES = [
  { size: "SMALL" as const, label: "Petit colis", description: "Vêtement plié, accessoire, petit objet.", creditCost: 1, maxLengthCm: 35, maxWidthCm: 25, maxHeightCm: 10, maxWeightGrams: 1000, sortOrder: 0 },
  { size: "MEDIUM" as const, label: "Moyen colis", description: "Chaussures, plusieurs vêtements, petit électronique.", creditCost: 2, maxLengthCm: 45, maxWidthCm: 35, maxHeightCm: 20, maxWeightGrams: 5000, sortOrder: 1 },
  { size: "LARGE" as const, label: "Grand colis", description: "Manteaux, lots, objets volumineux.", creditCost: 3, maxLengthCm: 70, maxWidthCm: 50, maxHeightCm: 50, maxWeightGrams: 20000, sortOrder: 2 },
];

/** Recharges de crédits supplémentaires : 10, 30, 50 ou 100 (prix modifiables par l'admin). */
export const DEFAULT_CREDIT_PACKS = [
  { name: "10 crédits", credits: 10, priceCents: 1990, sortOrder: 1 },
  { name: "30 crédits", credits: 30, priceCents: 5490, sortOrder: 2 },
  { name: "50 crédits", credits: 50, priceCents: 8490, sortOrder: 3 },
  { name: "100 crédits", credits: 100, priceCents: 15990, sortOrder: 4 },
];

const ALL: LocationType[] = ["BUSINESS_ADDRESS", "LOCKER", "RELAY_POINT"];

/**
 * Compatibilités par défaut, volontairement prudentes. Elles doivent être
 * vérifiées et ajustées par l'administrateur selon les options réellement
 * proposées par chaque fournisseur au moment de l'achat.
 */
export const DEFAULT_SUPPLIERS = [
  {
    code: "VINTED",
    name: "Vinted",
    websiteUrl: "https://www.vinted.fr",
    acceptedLocationTypes: ALL,
    acceptedNetworks: ["MONDIAL_RELAY", "INPOST", "RELAIS_COLIS", "VINTED_GO", "CHRONOPOST_PICKUP"],
    requiresPickupCode: true,
    sortOrder: 1,
    compatibilityNotes:
      "Les modes de livraison proposés dépendent du vendeur et du pays. Choisissez au paiement le point relais ou le locker de votre préparateur, avec le nom de destinataire indiqué. Transmettez ensuite le code de retrait reçu.",
  },
  {
    code: "ZENMARKET",
    name: "ZenMarket",
    websiteUrl: "https://zenmarket.jp/fr/",
    acceptedLocationTypes: ["BUSINESS_ADDRESS"] as LocationType[],
    acceptedNetworks: [],
    requiresPickupCode: false,
    sortOrder: 2,
    compatibilityNotes: "Expédition internationale vers une adresse complète avec numéro de téléphone : les lockers et points relais ne sont pas utilisables.",
  },
  {
    code: "SHEIN",
    name: "SHEIN",
    websiteUrl: "https://fr.shein.com",
    acceptedLocationTypes: ["BUSINESS_ADDRESS", "RELAY_POINT"] as LocationType[],
    acceptedNetworks: ["MONDIAL_RELAY", "RELAIS_COLIS"],
    requiresPickupCode: false,
    sortOrder: 3,
    compatibilityNotes: "La livraison en point relais n'est pas proposée pour toutes les commandes : vérifiez l'option au moment du paiement.",
  },
  {
    code: "ALIEXPRESS",
    name: "AliExpress",
    websiteUrl: "https://fr.aliexpress.com",
    acceptedLocationTypes: ["BUSINESS_ADDRESS"] as LocationType[],
    acceptedNetworks: [],
    requiresPickupCode: false,
    sortOrder: 4,
    compatibilityNotes: "Livraison à l'adresse professionnelle du préparateur recommandée. Les options de retrait varient selon le vendeur et ne sont pas activées par défaut.",
  },
  {
    code: "OTHER",
    name: "Autre fournisseur",
    websiteUrl: null,
    acceptedLocationTypes: ALL,
    acceptedNetworks: ["MONDIAL_RELAY", "INPOST", "RELAIS_COLIS", "VINTED_GO", "CHRONOPOST_PICKUP", "LA_POSTE", "UPS_ACCESS_POINT", "DPD_PICKUP", "GLS_RELAY", "AMAZON_LOCKER", "OTHER"],
    requiresPickupCode: false,
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
    await db.plan.upsert({ where: { code: plan.code }, create: { ...plan, features: [...plan.features] }, update: {} });
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
