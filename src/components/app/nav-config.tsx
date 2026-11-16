"use client";

import {
  BarChart3,
  Bell,
  Boxes,
  CalendarClock,
  Camera,
  ClipboardList,
  Coins,
  CreditCard,
  Headset,
  LayoutDashboard,
  MessagesSquare,
  Package,
  PackageCheck,
  Printer,
  Receipt,
  Settings,
  ShoppingBag,
  Siren,
  Store,
  Truck,
  UserRound,
  Users,
  Warehouse,
  ArrowLeftRight,
  Wallet,
  Send,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; badgeKey?: string; exact?: boolean };
export type NavGroup = { label?: string; items: NavItem[] };

export const NAV: Record<"CUSTOMER" | "PREPARER" | "ADMIN", NavGroup[]> = {
  CUSTOMER: [
    {
      items: [
        { href: "/client", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
        { href: "/client/preparateur", label: "Mon préparateur", icon: UserRound },
        { href: "/client/commander", label: "Commander des articles", icon: ShoppingBag },
      ],
    },
    {
      label: "Logistique",
      items: [
        { href: "/client/commandes", label: "Mes commandes", icon: Package },
        { href: "/client/stock", label: "Mon stock", icon: Boxes },
        { href: "/client/expeditions", label: "Mes expéditions", icon: Truck },
        { href: "/client/a-vendre", label: "À vendre", icon: Camera },
        { href: "/client/bordereaux", label: "Bordereaux", icon: Printer },
        { href: "/client/ventes", label: "Ventes et comptes liés", icon: Store },
        { href: "/client/incidents", label: "Incidents", icon: Siren },
      ],
    },
    {
      label: "Compte",
      items: [
        { href: "/client/messages", label: "Messages", icon: MessagesSquare, badgeKey: "messages" },
        { href: "/client/credits", label: "Mes crédits", icon: Coins },
        { href: "/client/facturation", label: "Facturation", icon: Receipt },
        { href: "/client/parametres", label: "Paramètres", icon: Settings },
      ],
    },
  ],
  PREPARER: [
    {
      items: [
        { href: "/preparateur", label: "Tableau de bord", icon: LayoutDashboard, exact: true },
        { href: "/preparateur/clients", label: "Mes clients", icon: Users },
      ],
    },
    {
      label: "Stock — envois normaux",
      items: [
        { href: "/preparateur/receptions", label: "Réceptions", icon: PackageCheck, badgeKey: "receptions" },
        { href: "/preparateur/stock", label: "Stock", icon: Warehouse },
        { href: "/preparateur/bordereaux", label: "Ventes normales", icon: Printer, badgeKey: "bordereaux" },
        { href: "/preparateur/expeditions", label: "Colis à envoyer", icon: Truck, badgeKey: "expeditions" },
        { href: "/preparateur/a-vendre", label: "Photos à vendre", icon: Camera, badgeKey: "photos" },
      ],
    },
    {
      label: "Dropshipping",
      items: [
        { href: "/preparateur/dropshipping", label: "Ventes dropshipping", icon: Zap, badgeKey: "dropship", exact: true },
        { href: "/preparateur/dropshipping/colis", label: "Colis dropshipping", icon: Send, badgeKey: "dropshipColis" },
      ],
    },
    {
      label: "Suivi",
      items: [{ href: "/preparateur/incidents", label: "Incidents", icon: Siren }],
    },
    {
      label: "Compte",
      items: [
        { href: "/preparateur/messages", label: "Messages", icon: MessagesSquare, badgeKey: "messages" },
        { href: "/preparateur/disponibilites", label: "Disponibilités", icon: CalendarClock },
        { href: "/preparateur/parametres", label: "Paramètres", icon: Settings },
      ],
    },
  ],
  ADMIN: [
    {
      items: [
        { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
        { href: "/admin/clients", label: "Clients", icon: Users },
        { href: "/admin/preparateurs", label: "Préparateurs", icon: UserRound },
        { href: "/admin/attributions", label: "Attributions", icon: ArrowLeftRight, badgeKey: "attributions" },
      ],
    },
    {
      label: "Logistique",
      items: [
        { href: "/admin/commandes", label: "Commandes", icon: Package },
        { href: "/admin/stocks", label: "Stocks", icon: Boxes },
        { href: "/admin/expeditions", label: "Expéditions", icon: Truck },
        { href: "/admin/incidents", label: "Incidents", icon: Siren, badgeKey: "incidents" },
      ],
    },
    {
      label: "Revenus",
      items: [
        { href: "/admin/abonnements", label: "Abonnements", icon: CreditCard },
        { href: "/admin/credits", label: "Crédits", icon: Wallet },
        { href: "/admin/paiements", label: "Paiements", icon: Receipt },
        { href: "/admin/statistiques", label: "Statistiques", icon: BarChart3 },
      ],
    },
    {
      label: "Plateforme",
      items: [
        { href: "/admin/support", label: "Messagerie et support", icon: Headset, badgeKey: "support" },
        { href: "/admin/notifications", label: "Notifications", icon: Bell },
        { href: "/admin/parametres", label: "Paramètres", icon: Settings },
        { href: "/admin/audit", label: "Journal d'audit", icon: ClipboardList },
      ],
    },
  ],
};
