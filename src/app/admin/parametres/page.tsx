import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Lock, Pencil, Plus, ShieldCheck } from "lucide-react";
import type { LocationType } from "@/generated/prisma/enums";
import { requireAdmin } from "@/server/auth/current";
import { can, type Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { getAllSettings } from "@/server/services/settings";
import { loadProfile } from "@/server/settings-page";
import { listAdmins } from "@/server/queries/admin-ops";
import { saveLegalSettingsAction, savePlatformSettingsAction, saveRoleAction, saveSupplierAction, setStaffRoleAction } from "@/server/actions/admin/ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { ActionDialog } from "@/components/shared/action-dialog";
import { CheckboxField, TextAreaField, TextField } from "@/components/shared/form-field";
import { PasswordForm, ProfileForm, SettingsNav } from "@/components/settings/account-forms";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Notice } from "@/components/admin/ops/ui";
import { CheckboxGroup } from "@/components/admin/ops/checkbox-group";
import { InviteAdminForm } from "@/components/admin/ops/client";
import { LOCATION_TYPE, PICKUP_NETWORKS, networkLabel } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Paramètres" };

const TABS = [
  { key: "plateforme", label: "Plateforme" },
  { key: "legal", label: "Légal" },
  { key: "fournisseurs", label: "Fournisseurs" },
  { key: "equipe", label: "Équipe et permissions" },
  { key: "compte", label: "Mon compte" },
];

const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export default async function AdminSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin();
  const requested = one((await searchParams).onglet);
  if (requested === "notifications") redirect("/admin/notifications");
  const tab = TABS.some((t) => t.key === requested) ? requested! : can(actor, "settings.manage") ? "plateforme" : "compte";
  const needed: Record<string, Permission | null> = { plateforme: "settings.manage", legal: "settings.manage", fournisseurs: "settings.manage", equipe: "roles.manage", compte: null };
  const permission = needed[tab];
  const allowed = !permission || can(actor, permission);

  return (
    <>
      <PageHeader title="Paramètres" description="Configuration de la plateforme, informations légales, fournisseurs compatibles et gestion de l'équipe." />
      <SettingsNav tabs={TABS} current={tab} basePath="/admin/parametres" />
      {!allowed ? (
        <Notice tone="warning">Votre rôle d&apos;administration ne permet pas d&apos;accéder à cet onglet.</Notice>
      ) : tab === "plateforme" ? (
        <PlatformTab />
      ) : tab === "legal" ? (
        <LegalTab />
      ) : tab === "fournisseurs" ? (
        <SuppliersTab />
      ) : tab === "equipe" ? (
        <TeamTab actor={actor} />
      ) : (
        <AccountTab actor={actor} />
      )}
    </>
  );
}

async function PlatformTab() {
  const s = await getAllSettings();
  return (
    <ActionForm action={savePlatformSettingsAction} className="grid gap-6 lg:grid-cols-2">
      <Section title="Attribution des préparateurs" description="L'attribution reste exclusivement manuelle : ce délai pilote les alertes et l'information des clients.">
        <TextField name="slaHours" label="Délai d'attribution garanti (heures)" type="number" min={1} max={168} defaultValue={s.assignment.slaHours} required hint="Affiché aux clients après souscription (24 h par défaut)." />
      </Section>
      <Section title="Supervision des conversations" description="Accès encadré d'un administrateur à une conversation client / préparateur, sur motif et journalisé.">
        <TextField name="supervisionMinutes" label="Durée d'un accès de supervision (minutes)" type="number" min={5} max={1440} defaultValue={s.messaging.supervisionMinutes} required />
      </Section>
      <Section title="Expédition" description="Engagement affiché aux clients ; au-delà, le préparateur et l'administration sont alertés. Le délai est suspendu pendant l'attente de crédits.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="shippingSlaHours" label="Délai d'expédition garanti (heures)" type="number" min={1} max={336} defaultValue={s.shipping.slaHours} required hint="48 h par défaut, à compter de la demande d'expédition." />
          <TextField name="shippingReturnCredits" label="Coût d'un retour à domicile (crédits)" type="number" min={0} max={100} defaultValue={s.shipping.returnCredits} required hint="Fixe, quelle que soit la taille du colis. Frais de port payés par le client (bordereau prépayé)." />
        </div>
      </Section>
      <Section title="Stockage" description="Durée de stockage par article, prolongations prélevées en crédits et places supplémentaires. Affiché sur le site, dans les CGV et dans l'espace client.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="storageIncludedDays" label="Durée incluse par article (jours)" type="number" min={1} max={365} defaultValue={s.storage.includedDays} required />
          <TextField name="storageExtensionDays" label="Durée d'une prolongation (jours)" type="number" min={1} max={365} defaultValue={s.storage.extensionDays} required />
          <TextField name="storageExtensionCredits" label="Coût d'une prolongation (crédits / article)" type="number" min={0} max={100} defaultValue={s.storage.extensionCredits} required />
          <TextField name="storageReminderDaysBefore" label="Rappel avant échéance (jours)" type="number" min={0} max={30} defaultValue={s.storage.reminderDaysBefore} required />
          <TextField name="storageSlotsPerCredit" label="Places supplémentaires pour 1 crédit" type="number" min={1} max={1000} defaultValue={s.storage.slotsPerCredit} required />
          <TextField name="storageExtraSlotsDays" label="Durée des places achetées (jours)" type="number" min={1} max={365} defaultValue={s.storage.extraSlotsDays} required />
        </div>
      </Section>
      <Section title="Contact du support" description="Affiché sur le site public, dans les e-mails et les pages légales." className="lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField name="supportEmail" label="E-mail du support" type="email" defaultValue={s.support.email} required />
          <TextField name="supportPhone" label="Téléphone" defaultValue={s.support.phone} placeholder="Facultatif" />
          <TextField name="supportHours" label="Horaires" defaultValue={s.support.hours} />
        </div>
      </Section>
      <div className="lg:col-span-2">
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer les paramètres</SubmitButton>
      </div>
    </ActionForm>
  );
}

const LEGAL_FIELDS: { key: string; label: string; wide?: boolean; area?: boolean }[] = [
  { key: "companyName", label: "Raison sociale" },
  { key: "legalForm", label: "Forme juridique" },
  { key: "capital", label: "Capital social" },
  { key: "siret", label: "SIRET" },
  { key: "rcs", label: "RCS (ville et numéro)" },
  { key: "vatNumber", label: "N° de TVA intracommunautaire" },
  { key: "address", label: "Adresse du siège", wide: true },
  { key: "publicationDirector", label: "Directeur de la publication" },
  { key: "contactEmail", label: "E-mail de contact juridique" },
  { key: "dpoEmail", label: "Contact protection des données (DPO)" },
  { key: "hostName", label: "Hébergeur" },
  { key: "hostAddress", label: "Adresse de l'hébergeur", wide: true },
  { key: "consumerMediator", label: "Médiateur de la consommation (nom et coordonnées)", wide: true, area: true },
];

async function LegalTab() {
  const { legal } = await getAllSettings();
  const values = legal as unknown as Record<string, string | undefined>;
  return (
    <Section title="Informations légales" description="Utilisées pour générer les mentions légales, CGU, CGV et la politique de confidentialité. Un champ vide apparaît comme « [À compléter] » sur le site.">
      <ActionForm action={saveLegalSettingsAction} className="grid gap-4 sm:grid-cols-2">
        {LEGAL_FIELDS.map((f) =>
          f.area ? (
            <TextAreaField key={f.key} name={f.key} label={f.label} defaultValue={values[f.key] ?? ""} rows={3} className="sm:col-span-2" />
          ) : (
            <TextField key={f.key} name={f.key} label={f.label} defaultValue={values[f.key] ?? ""} className={f.wide ? "sm:col-span-2" : undefined} />
          ),
        )}
        <p className="text-xs text-muted-foreground sm:col-span-2">Les documents générés sont des modèles : faites-les valider par un professionnel du droit avant la mise en production.</p>
        <div className="sm:col-span-2">
          <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
        </div>
      </ActionForm>
    </Section>
  );
}

type SupplierRow = {
  id: string;
  code: string;
  name: string;
  websiteUrl: string | null;
  description: string | null;
  acceptedLocationTypes: LocationType[];
  acceptedNetworks: string[];
  requiresPickupCode: boolean;
  compatibilityNotes: string | null;
  orderModes: ("STOCK" | "DROPSHIP")[];
  isActive: boolean;
  sortOrder: number;
};

function SupplierFields({ s }: { s?: SupplierRow }) {
  return (
    <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="grid grid-cols-2 gap-3">
        <TextField name="code" label="Code" defaultValue={s?.code} required placeholder="VINTED" />
        <TextField name="name" label="Nom" defaultValue={s?.name} required />
      </div>
      <TextField name="websiteUrl" label="Site web" type="url" defaultValue={s?.websiteUrl ?? ""} placeholder="https://" />
      <TextAreaField name="description" label="Description" defaultValue={s?.description ?? ""} rows={2} />
      <CheckboxGroup
        name="acceptedLocationTypes"
        label="Livre vers"
        options={(Object.keys(LOCATION_TYPE) as LocationType[]).map((t) => ({ value: t, label: LOCATION_TYPE[t] }))}
        selected={s?.acceptedLocationTypes ?? ["BUSINESS_ADDRESS"]}
        columns={3}
      />
      <CheckboxGroup name="acceptedNetworks" label="Réseaux de lockers / points relais acceptés" options={PICKUP_NETWORKS.map((n) => ({ value: n.code, label: n.label }))} selected={s?.acceptedNetworks ?? []} />
      <CheckboxField name="requiresPickupCode" label="Le retrait nécessite un code transmis au client" defaultChecked={s?.requiresPickupCode} />
      <TextAreaField name="compatibilityNotes" label="Notes de compatibilité (affichées au client)" defaultValue={s?.compatibilityNotes ?? ""} rows={3} />
      <CheckboxGroup
        name="orderModes"
        label="Proposé pour"
        options={[
          { value: "STOCK", label: "Commandes vers le stock" },
          { value: "DROPSHIP", label: "Dropshipping" },
        ]}
        selected={s?.orderModes ?? ["STOCK"]}
        columns={2}
      />
      <div className="grid grid-cols-[1fr_6rem] items-end gap-3">
        <CheckboxField name="isActive" label="Proposé aux clients" defaultChecked={s?.isActive ?? true} />
        <TextField name="sortOrder" label="Ordre" type="number" min={0} defaultValue={s?.sortOrder ?? 50} required />
      </div>
    </div>
  );
}

async function SuppliersTab() {
  const suppliers = await db.supplier.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { orders: true } } } });
  return (
    <Section
      title="Fournisseurs et compatibilité"
      description="Packio ne suppose jamais qu'un fournisseur livre vers n'importe quel point : chaque commande est vérifiée contre ces règles. Ajustez-les selon les options réellement proposées par chaque boutique."
      actions={
        <ActionDialog
          trigger={
            <Button size="sm">
              <Plus /> Ajouter un fournisseur
            </Button>
          }
          title="Nouveau fournisseur"
          action={saveSupplierAction}
          submitLabel="Créer"
          wide
        >
          <SupplierFields />
        </ActionDialog>
      }
      contentClassName="p-0"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Fournisseur</TableHead>
            <TableHead>Livre vers</TableHead>
            <TableHead className="min-w-64">Réseaux acceptés</TableHead>
            <TableHead>Proposé pour</TableHead>
            <TableHead>Code de retrait</TableHead>
            <TableHead className="text-right">Commandes</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="pr-5 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppliers.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="pl-5">
                <span className="font-medium">{s.name}</span>
                <span className="block font-mono text-xs text-muted-foreground">{s.code}</span>
              </TableCell>
              <TableCell className="text-xs">{s.acceptedLocationTypes.map((t) => LOCATION_TYPE[t]).join(", ")}</TableCell>
              <TableCell className="max-w-80 text-xs whitespace-normal text-muted-foreground">{s.acceptedNetworks.length ? s.acceptedNetworks.map(networkLabel).join(", ") : "—"}</TableCell>
              <TableCell className="text-xs">
                {s.orderModes.length ? s.orderModes.map((m) => (m === "STOCK" ? "Stock" : "Dropshipping")).join(", ") : <span className="text-muted-foreground">Aucun</span>}
              </TableCell>
              <TableCell className="text-xs">{s.requiresPickupCode ? "Requis" : "—"}</TableCell>
              <TableCell className="text-right tabular">{s._count.orders}</TableCell>
              <TableCell>
                <StatusBadge tone={s.isActive ? "success" : "neutral"} label={s.isActive ? "Actif" : "Inactif"} />
              </TableCell>
              <TableCell className="pr-5 text-right">
                <ActionDialog
                  trigger={
                    <Button variant="ghost" size="sm">
                      <Pencil /> Modifier
                    </Button>
                  }
                  title={`Modifier ${s.name}`}
                  action={saveSupplierAction}
                  submitLabel="Enregistrer"
                  wide
                >
                  <SupplierFields s={s} />
                </ActionDialog>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

async function TeamTab({ actor }: { actor: Actor }) {
  const [roles, admins] = await Promise.all([db.role.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { users: true } } } }), listAdmins()]);
  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));
  return (
    <div className="grid gap-6">
      <Section title="Membres de l'équipe" description="Comptes d'administration et rôle attribué. Un changement de rôle déconnecte la personne." contentClassName="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Membre</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Dernière connexion</TableHead>
              <TableHead className="pr-5">Rôle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="pl-5">
                  <span className="font-medium">
                    {a.firstName} {a.lastName}
                  </span>
                  {a.isDemo && <StatusBadge tone="info" label="Démo" dot={false} className="ml-2" />}
                  <span className="block text-xs text-muted-foreground">{a.email}</span>
                </TableCell>
                <TableCell>
                  {a.invitationPending ? <StatusBadge tone="warning" label="Invitation en attente" /> : <StatusBadge tone={a.status === "ACTIVE" ? "success" : "neutral"} label={a.status === "ACTIVE" ? "Actif" : "Désactivé"} />}
                </TableCell>
                <TableCell className="text-muted-foreground">{a.lastLoginAt ? formatDate(a.lastLoginAt) : "—"}</TableCell>
                <TableCell className="pr-5">
                  {a.id === actor.userId ? (
                    <span className="text-sm">{a.staffRole?.name ?? "—"} <span className="text-xs text-muted-foreground">(vous)</span></span>
                  ) : (
                    <ActionForm action={setStaffRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={a.id} />
                      <select name="roleId" defaultValue={a.staffRole?.id ?? ""} className="h-8 rounded-lg border border-input bg-background px-2 text-sm dark:bg-input/30" aria-label={`Rôle de ${a.firstName} ${a.lastName}`}>
                        {roleOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <SubmitButton size="sm" variant="outline">
                        Appliquer
                      </SubmitButton>
                    </ActionForm>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Inviter un administrateur" description="La personne reçoit un lien d'activation pour choisir son mot de passe.">
        <InviteAdminForm roles={roleOptions} />
      </Section>

      <Section
        title="Rôles et permissions"
        description="Le rôle super administrateur dispose de toutes les permissions et n'est pas modifiable."
        actions={
          <ActionDialog
            trigger={
              <Button size="sm">
                <Plus /> Nouveau rôle
              </Button>
            }
            title="Nouveau rôle"
            action={saveRoleAction}
            submitLabel="Créer le rôle"
            wide
          >
            <TextField name="name" label="Nom du rôle" required />
            <TextField name="description" label="Description" />
            <CheckboxGroup name="permissions" label="Permissions" options={PERMISSION_KEYS.map((p) => ({ value: p, label: PERMISSIONS[p] }))} selected={[]} />
          </ActionDialog>
        }
      >
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {roles.map((r) => {
            const isSuper = r.key === "super_admin";
            return (
              <div key={r.id} className="rounded-2xl border p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1.5 font-semibold">
                      {isSuper ? <ShieldCheck className="size-4 text-brand" /> : null}
                      {r.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.description ?? r.key} · {r._count.users} membre(s)
                    </p>
                  </div>
                  {isSuper && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3.5" /> Protégé
                    </span>
                  )}
                </div>
                {isSuper ? (
                  <p className="text-sm text-muted-foreground">Toutes les permissions (« * »).</p>
                ) : (
                  <ActionForm action={saveRoleAction} className="grid gap-3">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="name" value={r.name} />
                    <input type="hidden" name="description" value={r.description ?? ""} />
                    <CheckboxGroup name="permissions" label="Permissions" options={PERMISSION_KEYS.map((p) => ({ value: p, label: PERMISSIONS[p] }))} selected={r.permissions} />
                    <div>
                      <SubmitButton size="sm" variant="outline" pendingLabel="Enregistrement…">
                        Enregistrer les permissions
                      </SubmitButton>
                    </div>
                  </ActionForm>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

async function AccountTab({ actor }: { actor: Actor }) {
  const profile = await loadProfile(actor);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Profil">
        <ProfileForm user={profile} />
      </Section>
      <Section title="Sécurité" description="Changer votre mot de passe déconnecte vos autres sessions.">
        <PasswordForm />
      </Section>
    </div>
  );
}

