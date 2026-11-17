import { AppShell } from "@/components/app/app-shell";
import { CompleteDetailsScreen } from "@/components/client/complete-details-screen";
import { requireCustomer } from "@/server/auth/current";
import { navBadges } from "@/server/badges";
import { customerDetailsGate } from "@/server/services/customers";

export const dynamic = "force-dynamic";

export default async function SpaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireCustomer();
  // Après le paiement : nom, téléphone et adresse obligatoires avant d'accéder à l'espace.
  const details = await customerDetailsGate(actor.customerId);
  if (details)
    return <CompleteDetailsScreen defaults={details} email={actor.email} />;
  const badges = await navBadges(actor);
  return (
    <AppShell actor={actor} badges={badges}>
      {children}
    </AppShell>
  );
}
