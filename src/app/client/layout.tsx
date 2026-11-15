import { AppShell } from "@/components/app/app-shell";
import { requireCustomer } from "@/server/auth/current";
import { navBadges } from "@/server/badges";

export const dynamic = "force-dynamic";

export default async function SpaceLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireCustomer();
  const badges = await navBadges(actor);
  return (
    <AppShell actor={actor} badges={badges}>
      {children}
    </AppShell>
  );
}
