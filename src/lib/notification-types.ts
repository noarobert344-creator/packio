/**
 * Catalogue des notifications. `audience` détermine la page de préférences où
 * l'événement apparaît ; `locked` = notification de service non désactivable
 * par e-mail (sécurité, paiement).
 */
export const NOTIFICATION_TYPES = {
  ACCOUNT_CREATED: { label: "Compte créé", audience: ["CUSTOMER", "PREPARER"], email: true, locked: true },
  SUBSCRIPTION_ACTIVATED: { label: "Abonnement activé", audience: ["CUSTOMER"], email: true, locked: true },
  ASSIGNMENT_PENDING: { label: "Attribution en attente", audience: ["CUSTOMER"], email: true },
  ASSIGNMENT_DELAYED: { label: "Retard d'attribution", audience: ["CUSTOMER"], email: true },
  PREPARER_ASSIGNED: { label: "Préparateur attribué", audience: ["CUSTOMER"], email: true },
  CLIENT_ASSIGNED: { label: "Nouveau client attribué", audience: ["PREPARER"], email: true },
  CLIENT_UNASSIGNED: { label: "Client réattribué", audience: ["PREPARER"], email: true },
  ORDER_CREATED: { label: "Nouvelle commande enregistrée", audience: ["CUSTOMER", "PREPARER"], email: false },
  ORDER_UPDATED: { label: "Commande mise à jour", audience: ["CUSTOMER", "PREPARER"], email: false },
  PARCEL_AT_LOCKER: { label: "Colis disponible au locker", audience: ["PREPARER"], email: true },
  PARCEL_PICKED_UP: { label: "Colis récupéré", audience: ["CUSTOMER"], email: false },
  PARCEL_RECEIVED: { label: "Colis réceptionné", audience: ["CUSTOMER"], email: true },
  STOCK_UPDATED: { label: "Stock mis à jour", audience: ["CUSTOMER"], email: false },
  SHIPMENT_REQUESTED: { label: "Expédition demandée", audience: ["CUSTOMER", "PREPARER"], email: true },
  PARCEL_CLASSIFIED: { label: "Catégorie de colis déterminée", audience: ["CUSTOMER"], email: true },
  CREDITS_INSUFFICIENT: { label: "Crédits insuffisants", audience: ["CUSTOMER"], email: true },
  SHIPMENT_SHIPPED: { label: "Colis expédié", audience: ["CUSTOMER"], email: true },
  SHIPMENT_UPDATED: { label: "Expédition mise à jour", audience: ["CUSTOMER", "PREPARER"], email: false },
  NEW_MESSAGE: { label: "Nouvelle réponse dans la messagerie", audience: ["CUSTOMER", "PREPARER", "ADMIN"], email: true },
  INCIDENT: { label: "Incident logistique", audience: ["CUSTOMER", "PREPARER", "ADMIN"], email: true },
  PAYMENT_FAILED: { label: "Paiement échoué", audience: ["CUSTOMER", "ADMIN"], email: true, locked: true },
  SUBSCRIPTION_RENEWED: { label: "Abonnement renouvelé", audience: ["CUSTOMER"], email: true },
  SUBSCRIPTION_UPDATED: { label: "Abonnement modifié", audience: ["CUSTOMER"], email: true },
  CREDITS_ADDED: { label: "Crédits ajoutés", audience: ["CUSTOMER"], email: false },
  CREDITS_REMOVED_BY_PREPARER: { label: "Crédits retirés par votre préparateur", audience: ["CUSTOMER"], email: true, locked: true },
  STORAGE_REMINDER: { label: "Fin de la durée de stockage d'un article", audience: ["CUSTOMER"], email: true },
  STORAGE_CHARGED: { label: "Prolongation ou places de stockage", audience: ["CUSTOMER"], email: false },
  STORAGE_OVERDUE: { label: "Stockage impayé (crédits insuffisants)", audience: ["CUSTOMER", "ADMIN"], email: true },
  PRODUCT_PHOTOS: { label: "Photos d'article disponibles", audience: ["CUSTOMER"], email: false },
  SHIPMENT_LATE: { label: "Expédition en retard (48 h)", audience: ["PREPARER", "ADMIN"], email: true },
  MARKETPLACE_SALE: { label: "Vente détectée sur un compte lié", audience: ["CUSTOMER"], email: true },
  PREPARER_ABSENCE: { label: "Absence du préparateur", audience: ["CUSTOMER", "ADMIN"], email: true },
  ADMIN_ASSIGNMENT_REQUEST: { label: "Nouvelle demande d'attribution", audience: ["ADMIN"], email: true },
  ADMIN_ASSIGNMENT_LATE: { label: "Délai d'attribution dépassé", audience: ["ADMIN"], email: true },
  ADMIN_NO_PREPARER: { label: "Aucun préparateur disponible", audience: ["ADMIN"], email: true },
  ADMIN_CONTACT_REQUEST: { label: "Nouveau message de contact", audience: ["ADMIN"], email: true },
  ADMIN_PREPARER_ONBOARDED: { label: "Fiche d'un préparateur à valider", audience: ["ADMIN"], email: true },
  SECURITY: { label: "Sécurité du compte", audience: ["CUSTOMER", "PREPARER", "ADMIN"], email: true, locked: true },
} as const satisfies Record<
  string,
  { label: string; audience: readonly ("CUSTOMER" | "PREPARER" | "ADMIN")[]; email: boolean; locked?: boolean }
>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function notificationTypesFor(role: "CUSTOMER" | "PREPARER" | "ADMIN") {
  return (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).filter((t) =>
    (NOTIFICATION_TYPES[t].audience as readonly string[]).includes(role),
  );
}
