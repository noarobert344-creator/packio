import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePreparer } from "@/server/auth/current";
import { db } from "@/server/db";
import { PageHeader, Section } from "@/components/shared/page-header";
import { AvatarPicker } from "@/components/settings/account-forms";
import { OnboardingForm } from "@/components/preparer/onboarding-form";

export const metadata: Metadata = { title: "Bienvenue" };

/** Première connexion : fiche du préparateur (visible par ses clients une fois validée). */
export default async function PreparerOnboardingPage() {
  const actor = await requirePreparer();
  const profile = await db.preparerProfile.findUniqueOrThrow({
    where: { id: actor.preparerId },
    select: { onboardedAt: true, user: { select: { firstName: true, lastName: true, phone: true, avatarFileId: true } } },
  });
  if (profile.onboardedAt) redirect("/preparateur");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={`Bienvenue ${profile.user.firstName} !`}
        description="Quelques informations avant de recevoir vos premiers clients. Elles apparaissent sur votre fiche, visible par les clients qui vous sont attribués."
      />
      <Section title="Votre photo de profil" description="Vos clients voient votre photo : un visage identifié inspire confiance.">
        <AvatarPicker user={profile.user} hint="JPEG, PNG ou WebP." />
      </Section>
      <Section title="Vos coordonnées">
        <OnboardingForm defaultPhone={profile.user.phone} />
      </Section>
    </div>
  );
}
