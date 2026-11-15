import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IncidentDetail } from "@/components/incidents/incident-detail";
import { requireCustomer } from "@/server/auth/current";
import { getIncidentForActor } from "@/server/services/incidents";

export const metadata: Metadata = { title: "Incident" };

export default async function ClientIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireCustomer();
  const { id } = await params;
  const incident = await getIncidentForActor(actor, id).catch(() => null);
  if (!incident) notFound();
  return <IncidentDetail incident={incident} space="client" backHref="/client/incidents" />;
}
