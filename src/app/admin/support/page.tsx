import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye, Inbox, MessagesSquare } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { can, type Actor } from "@/server/auth/actor";
import { loadMessagingData } from "@/server/messaging-page";
import { listPairConversationsForAdmin } from "@/server/services/messaging";
import { getSetting } from "@/server/services/settings";
import { listContactRequests } from "@/server/queries/admin-people";
import { MessagingView } from "@/components/messaging/messaging-view";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableWrap } from "@/components/admin/people/display";
import { MarkContactHandled } from "@/components/admin/people/contact-handled";
import { SupervisionRequestDialog } from "@/components/admin/people/supervision-dialog";
import { formatDate, formatDateTime, formatRelative, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Messagerie et support — Administration" };

export default async function AdminSupportPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin();
  const canSupport = can(actor, "support.manage");
  const canSupervise = can(actor, "conversations.supervise");
  if (!canSupport && !canSupervise) redirect("/admin?refus=permission");
  const sp = await searchParams;
  const c = one(sp.c);
  const requested = one(sp.onglet);
  const tab = c ? "support" : requested === "supervision" && canSupervise ? "supervision" : requested === "contact" && canSupport ? "contact" : canSupport ? "support" : "supervision";

  const tabs = [
    ...(canSupport ? [{ key: "support", label: "Support", icon: MessagesSquare }] : []),
    ...(canSupervise ? [{ key: "supervision", label: "Supervision", icon: Eye }] : []),
    ...(canSupport ? [{ key: "contact", label: "Demandes de contact", icon: Inbox }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messagerie et support"
        description="Conversations de support avec les clients et préparateurs. La supervision des conversations privées est encadrée : motif obligatoire, durée limitée, journalisation et information des participants."
      />
      <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-muted p-1 scrollbar-none" aria-label="Sections">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/admin/support?onglet=${t.key}`}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
              tab === t.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4" /> {t.label}
          </Link>
        ))}
      </nav>
      {tab === "support" && <SupportTab actor={actor} conversationId={c} />}
      {tab === "supervision" && <SupervisionTab actor={actor} />}
      {tab === "contact" && <ContactTab />}
    </div>
  );
}

async function SupportTab({ actor, conversationId }: { actor: Actor; conversationId?: string }) {
  const data = await loadMessagingData(actor, conversationId);
  return (
    <MessagingView
      basePath="/admin/support"
      me={{ userId: actor.userId }}
      conversations={data.conversations}
      selected={data.selected}
      orderHref="/admin/commandes/"
      shipmentHref="/admin/expeditions/"
      adminControls
      emptyHint="Aucune demande de support pour le moment."
    />
  );
}

async function SupervisionTab({ actor }: { actor: Actor }) {
  const [conversations, { supervisionMinutes }] = await Promise.all([listPairConversationsForAdmin(actor), getSetting("messaging")]);
  return (
    <Section title="Conversations client / préparateur" description="Seules les métadonnées sont affichées. Le contenu n'est accessible qu'après une demande motivée.">
      {conversations.length === 0 ? (
        <EmptyState icon={MessagesSquare} title="Aucune conversation" />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Préparateur</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead>Dernier message</TableHead>
                <TableHead>État</TableHead>
                <TableHead className="text-right">Accès</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversations.map((conv) => {
                const grant = conv.accessGrants[0];
                const label = `${fullName(conv.customer?.user)} ↔ ${fullName(conv.preparer?.user)}`;
                return (
                  <TableRow key={conv.id}>
                    <TableCell className="text-sm">
                      {conv.customer ? (
                        <Link href={`/admin/clients/${conv.customer.id}`} className="font-medium hover:underline">
                          {fullName(conv.customer.user)}
                        </Link>
                      ) : (
                        "—"
                      )}
                      <p className="text-xs text-muted-foreground">{conv.customer?.referenceCode}</p>
                    </TableCell>
                    <TableCell className="text-sm">{fullName(conv.preparer?.user)}</TableCell>
                    <TableCell className="text-right tabular">{conv._count.messages}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatRelative(conv.lastMessageAt)}</TableCell>
                    <TableCell>{conv.status === "OPEN" ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label="Archivée" />}</TableCell>
                    <TableCell className="text-right">
                      {grant ? (
                        <Button asChild size="sm">
                          <Link href={`/admin/support?c=${conv.id}`}>
                            <Eye /> Consulter (jusqu&apos;à {grant.expiresAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })})
                          </Link>
                        </Button>
                      ) : (
                        <SupervisionRequestDialog conversationId={conv.id} label={label} minutes={supervisionMinutes} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </Section>
  );
}

async function ContactTab() {
  const requests = await listContactRequests();
  const pending = requests.filter((r) => r.status === "NEW").length;
  return (
    <Section title="Demandes reçues via le formulaire de contact" description={`${pending} demande(s) à traiter.`}>
      {requests.length === 0 ? (
        <EmptyState icon={Inbox} title="Aucune demande de contact" />
      ) : (
        <ul className="grid gap-3">
          {requests.map((r) => (
            <li key={r.id} className={cn("rounded-xl border p-4", r.status === "NEW" && "border-brand/40 bg-brand-soft/20")}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{r.subject}</p>
                    {r.status === "NEW" ? <StatusBadge tone="brand" label="Nouvelle" /> : <StatusBadge tone="neutral" label="Traitée" />}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {r.name} ·{" "}
                    <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.subject}`)}`} className="hover:underline">
                      {r.email}
                    </a>{" "}
                    · {formatDateTime(r.createdAt)}
                  </p>
                  <p className="pt-1 text-sm whitespace-pre-wrap">{r.message}</p>
                  {r.handledAt && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      Traitée le {formatDate(r.handledAt)} {r.handledBy && `par ${fullName(r.handledBy)}`}
                    </p>
                  )}
                </div>
                {r.status === "NEW" && <MarkContactHandled id={r.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
