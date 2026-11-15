import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/current";
import { PageHeader, Section } from "@/components/shared/page-header";
import { CreatePreparerForm } from "@/components/admin/people/preparer-forms";

export const metadata: Metadata = { title: "Nouveau préparateur — Administration" };

export default async function NewPreparerPage() {
  await requireAdmin("preparers.manage");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        back={{ href: "/admin/preparateurs", label: "Préparateurs" }}
        title="Ajouter un préparateur"
        description="Le préparateur reçoit une invitation pour activer son compte. Ajoutez ensuite ses lockers et points relais depuis sa fiche, puis validez-les."
      />
      <Section>
        <CreatePreparerForm />
      </Section>
    </div>
  );
}
