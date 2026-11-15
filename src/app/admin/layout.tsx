import { AppShell } from "@/components/app/app-shell";
import { requireAdmin } from "@/server/auth/current";
import { navBadges } from "@/server/badges";

export const dynamic = "force-dynamic";

export default async function SpaceLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdmin();
  const badges = await navBadges(actor);
  return (
    <AppShell actor={actor} badges={badges}>
      {children}
    </AppShell>
  );
}
