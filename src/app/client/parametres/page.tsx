import type { Metadata } from "next";
import { Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { ActionDialog } from "@/components/shared/action-dialog";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/shared/form-field";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import {
  NotificationPreferencesForm,
  PasswordForm,
  ProfileForm,
  SettingsNav,
} from "@/components/settings/account-forms";
import { PushDevice } from "@/components/settings/push-device";
import { getVapidPublicKey } from "@/server/services/push";
import { requireCustomer } from "@/server/auth/current";
import {
  loadNotificationPreferenceRows,
  loadProfile,
} from "@/server/settings-page";
import {
  requestAccountDeletionAction,
  updateReturnAddressAction,
} from "@/server/actions/customer";
import { db } from "@/server/db";
import { oneOf, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Paramètres" };

const TABS = [
  { key: "profil", label: "Profil" },
  { key: "securite", label: "Sécurité" },
  { key: "notifications", label: "Notifications" },
  { key: "donnees", label: "Données personnelles" },
] as const;

export default async function ClientSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireCustomer();
  const tab =
    oneOf(
      (await searchParams).onglet,
      TABS.map((t) => t.key),
    ) ?? "profil";
  const customer = await db.customerProfile.findUniqueOrThrow({
    where: { id: actor.customerId },
  });
  return (
    <div>
      <PageHeader
        title="Paramètres"
        description={`Compte client ${customer.referenceCode}`}
      />
      <SettingsNav
        tabs={[...TABS]}
        current={tab}
        basePath="/client/parametres"
      />
      {tab === "profil" && (
        <div className="space-y-6">
          <Section title="Profil">
            <ProfileForm user={await loadProfile(actor)} showCompany />
          </Section>
          <div id="retour" className="scroll-mt-24">
            <Section
              title="Mon adresse"
              description="Votre adresse, demandée après votre abonnement. Elle sert aussi aux retours de vos articles à domicile."
            >
              <ActionForm
                action={updateReturnAddressAction}
                className="grid max-w-2xl gap-4 sm:grid-cols-2"
              >
                <TextField
                  name="returnName"
                  label="Nom"
                  required
                  autoComplete="name"
                  defaultValue={
                    customer.returnName ??
                    `${actor.firstName} ${actor.lastName}`
                  }
                />
                <TextField
                  name="returnPhone"
                  label="Téléphone"
                  type="tel"
                  autoComplete="tel"
                  defaultValue={customer.returnPhone ?? ""}
                />
                <TextField
                  name="returnAddressLine1"
                  label="Adresse"
                  required
                  autoComplete="address-line1"
                  className="sm:col-span-2"
                  defaultValue={customer.returnAddressLine1 ?? ""}
                />
                <TextField
                  name="returnAddressLine2"
                  label="Complément d'adresse"
                  autoComplete="address-line2"
                  className="sm:col-span-2"
                  defaultValue={customer.returnAddressLine2 ?? ""}
                />
                <TextField
                  name="returnPostalCode"
                  label="Code postal"
                  required
                  autoComplete="postal-code"
                  defaultValue={customer.returnPostalCode ?? ""}
                />
                <TextField
                  name="returnCity"
                  label="Ville"
                  required
                  autoComplete="address-level2"
                  defaultValue={customer.returnCity ?? ""}
                />
                <SelectField
                  name="returnCountry"
                  label="Pays"
                  required
                  defaultValue={customer.returnCountry ?? "FR"}
                  options={[
                    { value: "FR", label: "France" },
                    { value: "BE", label: "Belgique" },
                    { value: "LU", label: "Luxembourg" },
                    { value: "CH", label: "Suisse" },
                    { value: "DE", label: "Allemagne" },
                    { value: "ES", label: "Espagne" },
                    { value: "IT", label: "Italie" },
                    { value: "NL", label: "Pays-Bas" },
                    { value: "PT", label: "Portugal" },
                  ]}
                />
                <div className="flex items-end">
                  <SubmitButton pendingLabel="Enregistrement…">
                    Enregistrer l&apos;adresse
                  </SubmitButton>
                </div>
              </ActionForm>
            </Section>
          </div>
        </div>
      )}
      {tab === "securite" && (
        <Section
          title="Mot de passe"
          description="Le changement de mot de passe déconnecte vos autres sessions."
        >
          <PasswordForm />
        </Section>
      )}
      {tab === "notifications" && (
        <div className="space-y-6">
          <Section
            title="Notifications sur ce téléphone"
            description="Activez-les sur chaque appareil où vous voulez être prévenu."
          >
            <PushDevice publicKey={await getVapidPublicKey()} />
          </Section>
          <Section
            title="Préférences de notification"
            description="Choisissez comment être informé de chaque événement : dans l'application, par e-mail ou sur votre téléphone. Les notifications de sécurité et de paiement restent visibles dans l'application."
          >
            <NotificationPreferencesForm
              rows={await loadNotificationPreferenceRows(actor)}
            />
          </Section>
        </div>
      )}
      {tab === "donnees" && (
        <div className="space-y-6">
          <Section
            title="Exporter mes données"
            description="Téléchargez l'ensemble des données associées à votre compte (droit à la portabilité)."
          >
            <Button asChild variant="outline">
              <a href="/api/me/export">
                <Download /> Télécharger mes données (JSON)
              </a>
            </Button>
          </Section>
          <Section
            title="Supprimer mon compte"
            description="La suppression nécessite la résiliation de l'abonnement et la restitution de votre stock. L'équipe Packio traite la demande et vous confirme la suppression."
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />{" "}
                Les factures sont conservées pendant la durée légale ; vos
                autres données personnelles sont anonymisées.
              </p>
              <ActionDialog
                trigger={
                  <Button variant="destructive">Demander la suppression</Button>
                }
                title="Demande de suppression du compte"
                description="Votre demande est transmise au support Packio, qui organisera si besoin la restitution de votre stock."
                action={requestAccountDeletionAction}
                submitLabel="Envoyer la demande"
                destructive
              >
                <TextAreaField
                  name="details"
                  label="Précisions (facultatif)"
                  rows={3}
                />
              </ActionDialog>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
