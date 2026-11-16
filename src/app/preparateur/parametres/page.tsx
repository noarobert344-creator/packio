import type { Metadata } from "next";
import { requirePreparer } from "@/server/auth/current";
import { loadNotificationPreferenceRows, loadProfile } from "@/server/settings-page";
import { NotificationPreferencesForm, PasswordForm, ProfileForm, SettingsNav } from "@/components/settings/account-forms";
import { PushDevice } from "@/components/settings/push-device";
import { getVapidPublicKey } from "@/server/services/push";
import { PageHeader, Section } from "@/components/shared/page-header";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Paramètres" };

const TABS = [
  { key: "profil", label: "Profil" },
  { key: "securite", label: "Sécurité" },
  { key: "notifications", label: "Notifications" },
];

export default async function PreparerSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePreparer();
  const requested = one((await searchParams).onglet);
  const tab = TABS.find((t) => t.key === requested)?.key ?? "profil";
  return (
    <div className="max-w-3xl">
      <PageHeader title="Paramètres" description="Votre profil, la sécurité de votre compte et vos notifications." />
      <SettingsNav tabs={TABS} current={tab} basePath="/preparateur/parametres" />
      {tab === "profil" && (
        <Section title="Profil" description="Vos clients voient votre nom et votre photo.">
          <ProfileForm user={await loadProfile(actor)} avatarHint="Photo de profil visible par vos clients (page « Mon préparateur » et messagerie). JPEG, PNG ou WebP." />
        </Section>
      )}
      {tab === "securite" && (
        <Section title="Mot de passe" description="Changer de mot de passe déconnecte vos autres sessions.">
          <PasswordForm />
        </Section>
      )}
      {tab === "notifications" && (
        <div className="space-y-6">
          <Section title="Notifications sur ce téléphone" description="Activez-les sur chaque appareil où vous voulez être prévenu.">
            <PushDevice publicKey={await getVapidPublicKey()} />
          </Section>
          <Section title="Notifications" description="Choisissez comment être prévenu de chaque événement.">
            <NotificationPreferencesForm rows={await loadNotificationPreferenceRows(actor)} />
          </Section>
        </div>
      )}
    </div>
  );
}
