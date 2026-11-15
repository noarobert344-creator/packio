import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePreparer } from "@/server/auth/current";
import { getIncidentForActor } from "@/server/services/incidents";
import { IncidentDetail } from "@/components/incidents/incident-detail";

export const metadata: Metadata = { title: "Incident" };

export default async function PreparerIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePreparer();
  const { id } = await params;
  const incident = await getIncidentForActor(actor, id).catch(() => null);
  if (!incident) notFound();
  return <IncidentDetail incident={incident} space="preparateur" backHref="/preparateur/incidents" />;
}
