import type {
  AssignmentState,
  CustomerStatus,
  IncidentPriority,
  IncidentStatus,
  IncidentType,
  InventoryMovementType,
  InventoryStatus,
  LocationType,
  ParcelSize,
  PaymentStatus,
  PreparerStatus,
  ShipmentCreditState,
  ShipmentStatus,
  SubscriptionStatus,
  SupplierOrderStatus,
  CreditTransactionType,
  MarketplacePlatform,
  MarketplaceSaleStatus,
  ShipmentKind,
} from "@/generated/prisma/enums";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

type Labeled = { label: string; tone: Tone; description?: string };

export const SUPPLIER_ORDER_STATUS: Record<SupplierOrderStatus, Labeled> = {
  REGISTERED: { label: "Commande enregistrée", tone: "neutral" },
  SUPPLIER_CONFIRMED: { label: "Commande fournisseur confirmée", tone: "info" },
  IN_TRANSIT: { label: "En cours d'acheminement", tone: "info" },
  AT_LOCKER: { label: "Arrivé, à récupérer", tone: "brand" },
  PICKED_UP: { label: "Récupérée par le préparateur", tone: "brand" },
  RECEIVED: { label: "Réceptionnée", tone: "success" },
  QUALITY_CHECK: { label: "Contrôle qualité en cours", tone: "warning" },
  IN_STOCK: { label: "En stock", tone: "success" },
  INCIDENT: { label: "Incident", tone: "danger" },
  RETURNED_TO_SUPPLIER: { label: "Retour fournisseur", tone: "warning" },
  CANCELLED: { label: "Annulée", tone: "neutral" },
};

export const SUPPLIER_ORDER_FLOW: SupplierOrderStatus[] = [
  "REGISTERED",
  "SUPPLIER_CONFIRMED",
  "IN_TRANSIT",
  "AT_LOCKER",
  "PICKED_UP",
  "RECEIVED",
  "QUALITY_CHECK",
  "IN_STOCK",
];

export const SHIPMENT_STATUS: Record<ShipmentStatus, Labeled> = {
  REQUESTED: { label: "Expédition demandée", tone: "neutral" },
  AWAITING_CLASSIFICATION: { label: "En attente de classification", tone: "warning" },
  CLASSIFIED: { label: "Classification confirmée", tone: "info" },
  AWAITING_CREDITS: { label: "En attente de crédits", tone: "danger" },
  PREPARING: { label: "Préparation en cours", tone: "brand" },
  READY: { label: "Colis prêt", tone: "brand" },
  LABEL_READY: { label: "Étiquette créée ou fournie", tone: "brand" },
  DROPPED_OFF: { label: "Déposé au transporteur", tone: "success" },
  IN_TRANSIT: { label: "En transit", tone: "info" },
  DELIVERED: { label: "Livré", tone: "success" },
  INCIDENT: { label: "Incident", tone: "danger" },
  CANCELLED: { label: "Annulée", tone: "neutral" },
};

export const SHIPMENT_FLOW: ShipmentStatus[] = [
  "REQUESTED",
  "AWAITING_CLASSIFICATION",
  "CLASSIFIED",
  "PREPARING",
  "READY",
  "LABEL_READY",
  "DROPPED_OFF",
  "IN_TRANSIT",
  "DELIVERED",
];

export const SHIPMENT_ACTIVE_STATUSES: ShipmentStatus[] = [
  "REQUESTED",
  "AWAITING_CLASSIFICATION",
  "CLASSIFIED",
  "AWAITING_CREDITS",
  "PREPARING",
  "READY",
  "LABEL_READY",
];

export const SHIPMENT_CANCELLABLE_BY_CUSTOMER: ShipmentStatus[] = [
  "REQUESTED",
  "AWAITING_CLASSIFICATION",
  "CLASSIFIED",
  "AWAITING_CREDITS",
];

export const CREDIT_STATE: Record<ShipmentCreditState, Labeled> = {
  NONE: { label: "Non calculé", tone: "neutral" },
  RESERVED: { label: "Crédits réservés", tone: "info" },
  INSUFFICIENT: { label: "Solde insuffisant", tone: "danger" },
  CAPTURED: { label: "Crédits débités", tone: "success" },
  RELEASED: { label: "Crédits libérés", tone: "neutral" },
};

export const PARCEL_SIZE: Record<ParcelSize, { label: string; short: string }> = {
  SMALL: { label: "Petit colis", short: "Petit" },
  MEDIUM: { label: "Moyen colis", short: "Moyen" },
  LARGE: { label: "Grand colis", short: "Grand" },
};

export const INVENTORY_STATUS: Record<InventoryStatus, Labeled> = {
  IN_STOCK: { label: "En stock", tone: "success" },
  RESERVED: { label: "Réservé", tone: "info" },
  DEPLETED: { label: "Épuisé", tone: "neutral" },
  DAMAGED: { label: "Abîmé", tone: "danger" },
  ARCHIVED: { label: "Archivé", tone: "neutral" },
};

export const MOVEMENT_TYPE: Record<InventoryMovementType, string> = {
  RECEIPT: "Réception",
  ADJUSTMENT: "Ajustement",
  RESERVATION: "Réservation expédition",
  RESERVATION_RELEASE: "Libération de réservation",
  SHIPMENT: "Expédition",
  DAMAGE: "Article abîmé",
  MISSING: "Article manquant",
  FOUND: "Article retrouvé",
  INVENTORY_COUNT: "Inventaire",
  TRANSFER_OUT: "Transfert sortant",
  TRANSFER_IN: "Transfert entrant",
};

export const CREDIT_TX_TYPE: Record<CreditTransactionType, string> = {
  MONTHLY_GRANT: "Crédits mensuels",
  PLAN_CHANGE_GRANT: "Changement d'offre",
  PURCHASE: "Recharge de crédits",
  RESERVATION: "Réservation",
  RESERVATION_RELEASE: "Libération",
  CAPTURE: "Débit définitif",
  EXPIRY: "Expiration",
  ADMIN_CREDIT: "Crédit manuel",
  ADMIN_DEBIT: "Débit manuel",
  REFUND_DEBIT: "Retrait suite à remboursement",
  STORAGE_FEE: "Stockage",
  PREPARER_DEBIT: "Retrait par votre préparateur",
};

export const SHIPMENT_KIND: Record<ShipmentKind, Labeled> = {
  SALE: { label: "Vente", tone: "neutral" },
  RETURN_TO_CUSTOMER: { label: "Retour au client", tone: "info" },
  DROPSHIP: { label: "Dropshipping express", tone: "brand" },
};

export const MARKETPLACE_PLATFORM: Record<MarketplacePlatform, string> = {
  VINTED: "Vinted",
  VESTIAIRE: "Vestiaire Collective",
  OTHER: "Autre plateforme",
};

export const MARKETPLACE_SALE_STATUS: Record<MarketplaceSaleStatus, Labeled> = {
  NEW: { label: "À traiter", tone: "warning" },
  MATCHED: { label: "Article identifié", tone: "info" },
  SHIPMENT_CREATED: { label: "Vente normale", tone: "success" },
  DROPSHIP: { label: "Vente dropshipping", tone: "brand" },
  IGNORED: { label: "Supprimée", tone: "neutral" },
  CANCELLED: { label: "Annulée", tone: "neutral" },
};

export const ASSIGNMENT_STATE: Record<AssignmentState, Labeled> = {
  NOT_REQUESTED: { label: "Non demandée", tone: "neutral" },
  PENDING: { label: "En attente", tone: "warning" },
  ASSIGNED: { label: "Attribué", tone: "success" },
  LATE: { label: "Retard", tone: "danger" },
  REASSIGNING: { label: "Réattribution", tone: "info" },
};

export const CUSTOMER_STATUS: Record<CustomerStatus, Labeled> = {
  PENDING_PAYMENT: { label: "Paiement en attente", tone: "neutral" },
  ACTIVE: { label: "Actif", tone: "success" },
  PAST_DUE: { label: "Paiement en retard", tone: "danger" },
  CANCELED: { label: "Résilié", tone: "neutral" },
  SUSPENDED: { label: "Suspendu", tone: "danger" },
};

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, Labeled> = {
  INCOMPLETE: { label: "Incomplet", tone: "warning" },
  INCOMPLETE_EXPIRED: { label: "Expiré", tone: "neutral" },
  TRIALING: { label: "Essai", tone: "info" },
  ACTIVE: { label: "Actif", tone: "success" },
  PAST_DUE: { label: "Impayé", tone: "danger" },
  CANCELED: { label: "Résilié", tone: "neutral" },
  UNPAID: { label: "Impayé", tone: "danger" },
  PAUSED: { label: "En pause", tone: "warning" },
};

export const PREPARER_STATUS: Record<PreparerStatus, Labeled> = {
  ACTIVE: { label: "Actif", tone: "success" },
  UNAVAILABLE: { label: "Indisponible", tone: "warning" },
  SUSPENDED: { label: "Suspendu", tone: "danger" },
};

export const LOCATION_TYPE: Record<LocationType, string> = {
  BUSINESS_ADDRESS: "Adresse de domiciliation",
  LOCKER: "Locker",
  RELAY_POINT: "Point relais",
  POST_OFFICE: "Poste restante (bureau de poste)",
};

export const PAYMENT_STATUS: Record<PaymentStatus, Labeled> = {
  PENDING: { label: "En attente", tone: "neutral" },
  SUCCEEDED: { label: "Réussi", tone: "success" },
  FAILED: { label: "Échoué", tone: "danger" },
  REFUNDED: { label: "Remboursé", tone: "warning" },
  PARTIALLY_REFUNDED: { label: "Partiellement remboursé", tone: "warning" },
};

export const INCIDENT_TYPE: Record<IncidentType, string> = {
  INBOUND_DAMAGED: "Colis entrant abîmé",
  INBOUND_MISSING: "Colis entrant manquant",
  WRONG_ITEM: "Article non conforme",
  LOCKER_ISSUE: "Problème de locker / point relais",
  SHIPMENT_ISSUE: "Problème d'expédition",
  CLASSIFICATION_DISPUTE: "Contestation de classification",
  STOCK_DISCREPANCY: "Écart de stock",
  PAYMENT: "Paiement",
  ASSIGNMENT_DELAY: "Retard d'attribution",
  PREPARER_ABSENCE: "Absence préparateur",
  OTHER: "Autre",
};

export const INCIDENT_STATUS: Record<IncidentStatus, Labeled> = {
  OPEN: { label: "Ouvert", tone: "danger" },
  IN_PROGRESS: { label: "En cours", tone: "warning" },
  RESOLVED: { label: "Résolu", tone: "success" },
  CLOSED: { label: "Clôturé", tone: "neutral" },
};

export const INCIDENT_PRIORITY: Record<IncidentPriority, Labeled> = {
  LOW: { label: "Basse", tone: "neutral" },
  NORMAL: { label: "Normale", tone: "info" },
  HIGH: { label: "Haute", tone: "warning" },
  URGENT: { label: "Urgente", tone: "danger" },
};

/** Transporteurs pris en charge (expédition et acheminement). */
export const CARRIERS = [
  { code: "COLISSIMO", label: "Colissimo" },
  { code: "LA_POSTE", label: "La Poste (Lettre suivie)" },
  { code: "CHRONOPOST", label: "Chronopost" },
  { code: "MONDIAL_RELAY", label: "Mondial Relay" },
  { code: "RELAIS_COLIS", label: "Relais Colis" },
  { code: "INPOST", label: "InPost" },
  { code: "VINTED_GO", label: "Vinted Go" },
  { code: "DPD", label: "DPD" },
  { code: "GLS", label: "GLS" },
  { code: "UPS", label: "UPS" },
  { code: "DHL", label: "DHL" },
  { code: "FEDEX", label: "FedEx" },
  { code: "COLIS_PRIVE", label: "Colis Privé" },
  { code: "CAINIAO", label: "Cainiao" },
  { code: "OTHER", label: "Autre transporteur" },
] as const;

/** Réseaux de lockers et points relais. */
export const PICKUP_NETWORKS = [
  { code: "MONDIAL_RELAY", label: "Mondial Relay (Point Relais® / Locker)" },
  { code: "INPOST", label: "InPost (Lockers)" },
  { code: "RELAIS_COLIS", label: "Relais Colis" },
  { code: "VINTED_GO", label: "Vinted Go (Lockers)" },
  { code: "CHRONOPOST_PICKUP", label: "Chronopost Pickup / Shop2Shop" },
  { code: "LA_POSTE", label: "La Poste (bureau / Pickup Station)" },
  { code: "UPS_ACCESS_POINT", label: "UPS Access Point" },
  { code: "DPD_PICKUP", label: "DPD Pickup" },
  { code: "GLS_RELAY", label: "GLS Relais" },
  { code: "AMAZON_LOCKER", label: "Amazon Locker / Counter" },
  { code: "OTHER", label: "Autre réseau" },
] as const;

export function carrierLabel(code: string | null | undefined) {
  if (!code) return "—";
  return CARRIERS.find((c) => c.code === code)?.label ?? code;
}

export function networkLabel(code: string | null | undefined) {
  if (!code) return "—";
  return PICKUP_NETWORKS.find((c) => c.code === code)?.label ?? code;
}

export const SHIPMENT_OPTIONS = [
  { code: "REINFORCED", label: "Protection renforcée" },
  { code: "GIFT_WRAP", label: "Emballage cadeau" },
  { code: "NO_INVOICE", label: "Ne pas inclure de facture / prix" },
  { code: "PHOTO_BEFORE", label: "Photos avant fermeture du colis" },
  { code: "ECO_PACKAGING", label: "Emballage recyclé de préférence" },
  { code: "INSERT_NOTE", label: "Glisser un mot (voir instructions)" },
] as const;

export function shipmentOptionLabel(code: string) {
  return SHIPMENT_OPTIONS.find((o) => o.code === code)?.label ?? code;
}
