import Link from "next/link";
import { FlaskConical } from "lucide-react";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { initials } from "@/lib/format";
import { unreadNotificationCount } from "@/server/services/notifications";
import { MobileNav, Sidebar } from "./sidebar";
import { NotificationBell } from "./notification-bell";
import { RealtimeProvider } from "./realtime";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { GlobalSearch } from "./global-search";
import { Logo } from "@/components/brand/logo";
import { OfflineBanner } from "./offline-banner";
import { CreditsBadge } from "./credits-badge";

const ROLE_LABEL = { CUSTOMER: "Client", PREPARER: "Préparateur", ADMIN: "Administration Packio" } as const;
const SETTINGS = { CUSTOMER: "/client/parametres", PREPARER: "/preparateur/parametres", ADMIN: "/admin/parametres" } as const;
const SUPPORT = { CUSTOMER: "/client/messages?support=1", PREPARER: "/preparateur/messages?support=1", ADMIN: undefined } as const;

export async function AppShell({ actor, badges = {}, children }: { actor: Actor; badges?: Record<string, number>; children: React.ReactNode }) {
  const [user, unread, wallet] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { avatarFileId: true } }),
    unreadNotificationCount(actor.userId),
    actor.role === "CUSTOMER" && actor.customerId
      ? db.creditWallet.findUnique({ where: { customerId: actor.customerId }, select: { monthlyBalance: true, purchasedBalance: true } })
      : null,
  ]);
  const showDemoBanner = actor.isDemo || env.billingMode === "dev";
  const footer = (
    <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {actor.firstName} {actor.lastName}
        </p>
        <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[actor.role]}</p>
      </div>
    </div>
  );
  return (
    <RealtimeProvider initialUnread={unread}>
      <Sidebar role={actor.role} badges={badges} footer={footer} />
      <div className="flex min-h-dvh flex-col lg:pl-64">
        <OfflineBanner />
        {showDemoBanner && (
          <div className="flex items-center justify-center gap-2 border-b border-warning/25 bg-warning-soft px-4 py-1.5 text-center text-xs text-warning">
            <FlaskConical className="size-3.5 shrink-0" />
            <span>
              Environnement de démonstration — données fictives{env.billingMode === "dev" ? ", paiements simulés (aucun encaissement)" : ""}.
            </span>
          </div>
        )}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 sm:px-6">
          <MobileNav role={actor.role} badges={badges} footer={footer} />
          <Link href="/" className="lg:hidden" aria-label="Accueil">
            <Logo wordmark={false} />
          </Link>
          {actor.role === "ADMIN" && <GlobalSearch />}
          <div className="ml-auto flex items-center gap-1">
            {actor.role === "CUSTOMER" && actor.customerId && <CreditsBadge initial={(wallet?.monthlyBalance ?? 0) + (wallet?.purchasedBalance ?? 0)} />}
            <ThemeToggle />
            <NotificationBell settingsHref={`${SETTINGS[actor.role]}?onglet=notifications`} />
            <div className="ml-1">
              <UserMenu
                name={`${actor.firstName} ${actor.lastName}`}
                email={actor.email}
                initials={initials(actor.firstName, actor.lastName)}
                avatarUrl={user?.avatarFileId ? `/api/files/${user.avatarFileId}` : null}
                settingsHref={SETTINGS[actor.role]}
                supportHref={SUPPORT[actor.role]}
                roleLabel={actor.otherSpaces?.length ? `${ROLE_LABEL[actor.role]} · compte administrateur` : ROLE_LABEL[actor.role]}
                otherSpaces={actor.otherSpaces}
              />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </RealtimeProvider>
  );
}
