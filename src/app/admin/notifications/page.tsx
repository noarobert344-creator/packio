import type { Metadata } from "next";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import type { EmailStatus } from "@/generated/prisma/enums";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { env } from "@/server/env";
import { getSetting } from "@/server/services/settings";
import { loadNotificationPreferenceRows } from "@/server/settings-page";
import { PAGE_SIZE, latestEmailLogs, listMyNotifications } from "@/server/queries/admin-ops";
import { markMyNotificationsReadAction, saveAdminEmailsAction } from "@/server/actions/admin/ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { ActionButton } from "@/components/shared/action-dialog";
import { TextAreaField } from "@/components/shared/form-field";
import { Pagination } from "@/components/shared/list-controls";
import { NotificationPreferencesForm } from "@/components/settings/account-forms";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Notice } from "@/components/admin/ops/ui";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notification-types";
import type { Tone } from "@/lib/labels";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { parsePage, type SearchParams } from "@/lib/params";
import { PushDevice } from "@/components/settings/push-device";
import { getVapidPublicKey } from "@/server/services/push";

export const metadata: Metadata = { title: "Notifications" };

const EMAIL_STATUS: Record<EmailStatus, { label: string; tone: Tone }> = {
  SENT: { label: "Envoyé", tone: "success" },
  FAILED: { label: "Échec", tone: "danger" },
  SKIPPED: { label: "Ignoré", tone: "neutral" },
  LOGGED: { label: "Journalisé (dev)", tone: "info" },
};

export default async function AdminNotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin();
  const manage = can(actor, "notifications.manage");
  const page = parsePage((await searchParams).page);
  const [mine, prefs, settings, emails] = await Promise.all([
    listMyNotifications(actor.userId, page),
    loadNotificationPreferenceRows(actor),
    manage ? getSetting("notifications") : Promise.resolve(null),
    manage ? latestEmailLogs(100) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Notifications" description="Vos alertes, vos préférences de réception et la configuration des notifications administrateur." />
      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <Section
          title="Mes notifications"
          description={`${mine.unread} non lue(s) sur ${mine.total}`}
          actions={
            mine.unread > 0 && (
              <ActionButton action={markMyNotificationsReadAction} variant="outline" size="sm">
                <CheckCheck /> Tout marquer comme lu
              </ActionButton>
            )
          }
          contentClassName="p-0"
        >
          {mine.items.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={Bell} title="Aucune notification" description="Les alertes d'attribution, d'incident et de paiement apparaîtront ici." />
            </div>
          ) : (
            <ul className="divide-y">
              {mine.items.map((n) => {
                const body = (
                  <div className={cn("flex gap-3 px-5 py-3.5", !n.readAt && "bg-brand-soft/40")}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-sm font-medium">{n.title}</p>
                        <time className="text-xs text-muted-foreground" title={formatDateTime(n.createdAt)}>
                          {formatRelative(n.createdAt)}
                        </time>
                      </div>
                      <p className="text-sm text-muted-foreground">{n.body}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground/80">{NOTIFICATION_TYPES[n.type as NotificationType]?.label ?? n.type}</p>
                    </div>
                  </div>
                );
                return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-muted/50">{body}</Link> : body}</li>;
              })}
            </ul>
          )}
          <div className="px-5 pb-4">
            <Pagination page={page} pageSize={PAGE_SIZE} total={mine.total} basePath="/admin/notifications" params={{}} />
          </div>
        </Section>
        <div className="space-y-6">
          {manage && settings && (
            <Section title="Destinataires des alertes" description="Adresses supplémentaires recevant les alertes administrateur (attribution en retard, aucun préparateur disponible, paiement échoué, incident…).">
              <ActionForm action={saveAdminEmailsAction} className="grid gap-3">
                <TextAreaField name="adminEmails" label="Adresses e-mail (une par ligne)" defaultValue={settings.adminEmails.join("\n")} rows={4} placeholder="operations@exemple.fr" hint="10 adresses maximum. Les administrateurs reçoivent déjà les alertes selon leurs préférences." />
                <div>
                  <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
                </div>
              </ActionForm>
            </Section>
          )}
          <Section title="Notifications sur ce téléphone" description="Activez-les sur chaque appareil où vous voulez être prévenu.">
            <PushDevice publicKey={await getVapidPublicKey()} />
          </Section>
          <Section title="Mes préférences" description="Choisissez comment être prévenu pour chaque type d'événement : application, e-mail ou téléphone.">
            <NotificationPreferencesForm rows={prefs} />
          </Section>
        </div>
      </div>
      {manage && (
        <Section title="Journal des e-mails" description="100 derniers e-mails transactionnels." className="mt-6" contentClassName="p-0">
          {!env.resendApiKey && (
            <div className="p-5 pb-0">
              <Notice>
                Aucun service d&apos;envoi configuré (<code>RESEND_API_KEY</code>) : les e-mails sont journalisés sans être envoyés.
              </Notice>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Date</TableHead>
                <TableHead>Destinataire</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Modèle</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="pr-5">Erreur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(e.createdAt)}</TableCell>
                  <TableCell className="text-xs">{e.toEmail}</TableCell>
                  <TableCell className="max-w-72 truncate">{e.subject}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{e.template}</TableCell>
                  <TableCell>
                    <StatusFrom map={EMAIL_STATUS} value={e.status} />
                  </TableCell>
                  <TableCell className="max-w-64 pr-5 text-xs whitespace-normal text-danger">{e.error ?? ""}</TableCell>
                </TableRow>
              ))}
              {emails.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Aucun e-mail.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Section>
      )}
    </>
  );
}
