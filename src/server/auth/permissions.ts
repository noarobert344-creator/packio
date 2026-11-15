/**
 * Permissions du back-office. Le rôle système "super_admin" possède "*".
 * Les clients et préparateurs n'ont pas de permissions administratives :
 * leur périmètre est déterminé par la propriété des données (voir policy.ts).
 */
export const PERMISSIONS = {
  "customers.read": "Consulter les clients",
  "customers.manage": "Gérer les clients",
  "preparers.read": "Consulter les préparateurs",
  "preparers.manage": "Créer, modifier et suspendre des préparateurs",
  "assignments.manage": "Attribuer et réattribuer les préparateurs",
  "operations.read": "Consulter commandes, stocks et expéditions",
  "operations.manage": "Intervenir sur les opérations logistiques",
  "billing.read": "Consulter abonnements, paiements et revenus",
  "billing.manage": "Gérer offres, remboursements et coupons",
  "credits.manage": "Créditer, débiter et corriger les soldes",
  "support.manage": "Répondre aux conversations de support",
  "conversations.supervise": "Superviser les conversations client / préparateur",
  "incidents.manage": "Traiter les incidents",
  "stats.read": "Consulter les statistiques",
  "notifications.manage": "Configurer les notifications",
  "settings.manage": "Modifier les paramètres de la plateforme",
  "roles.manage": "Gérer les rôles et permissions",
  "audit.read": "Consulter le journal d'audit",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const SYSTEM_ROLES = [
  {
    key: "super_admin",
    name: "Super administrateur",
    description: "Propriétaire de la plateforme — toutes les permissions.",
    permissions: ["*"],
  },
  {
    key: "operations",
    name: "Opérations logistiques",
    description: "Suivi des préparateurs, attributions, opérations et incidents.",
    permissions: [
      "customers.read",
      "preparers.read",
      "preparers.manage",
      "assignments.manage",
      "operations.read",
      "operations.manage",
      "incidents.manage",
      "stats.read",
    ],
  },
  {
    key: "support",
    name: "Support client",
    description: "Support, consultation des clients et des incidents.",
    permissions: ["customers.read", "operations.read", "support.manage", "incidents.manage"],
  },
] as const;

export function hasPermission(granted: readonly string[], permission: Permission): boolean {
  return granted.includes("*") || granted.includes(permission);
}
