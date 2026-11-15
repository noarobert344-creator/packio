"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, isSameDay, isToday, isYesterday } from "date-fns";
import { fr } from "date-fns/locale";
import { Archive, ArrowLeft, Check, CheckCheck, Eye, FileText, Headset, Link2, Loader2, MessagesSquare, Paperclip, Plus, Search, Send, ShieldCheck, Truck, X, Package } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionDialog } from "@/components/shared/action-dialog";
import { TextAreaField, TextField } from "@/components/shared/form-field";
import { uploadToPackio, type UploadedFile } from "@/components/shared/file-uploader";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createSupportRequestAction } from "@/server/actions/account";
import { markConversationReadAction, searchMessagesAction, sendMessageAction, setSupportStatusAction } from "@/server/actions/messaging";
import type { ConversationSummary, SelectedConversation, ThreadMessage } from "./types";

type ApiMessage = Omit<ThreadMessage, "sender"> & {
  sender: { id: string; firstName: string; lastName: string; role: "CUSTOMER" | "PREPARER" | "ADMIN" } | null;
};

type Props = {
  basePath: string;
  me: { userId: string };
  conversations: ConversationSummary[];
  selected: SelectedConversation | null;
  orderHref?: string;
  shipmentHref?: string;
  allowNewSupport?: boolean;
  adminControls?: boolean;
  emptyHint?: string;
  openSupportDialog?: boolean;
};

function dayLabel(d: Date) {
  if (isToday(d)) return "Aujourd'hui";
  if (isYesterday(d)) return "Hier";
  return format(d, "EEEE d MMMM", { locale: fr });
}

export function MessagingView(props: Props) {
  const { conversations, selected, basePath } = props;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchMessagesAction>> | null>(null);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => startSearch(async () => setResults(await searchMessagesAction(query))), 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="grid h-[calc(100dvh-10.5rem)] min-h-[32rem] overflow-hidden rounded-2xl border bg-card shadow-soft md:grid-cols-[20rem_1fr]">
      <aside className={cn("flex min-h-0 flex-col border-r", selected && "hidden md:flex")}>
        <div className="space-y-3 border-b p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher dans les messages" className="h-9 pl-9" type="search" aria-label="Rechercher dans les messages" />
            {searching && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {props.allowNewSupport && (
            <ActionDialog
              trigger={
                <Button variant="outline" size="sm" className="w-full">
                  <Headset /> Contacter le support Packio
                </Button>
              }
              title="Nouvelle demande au support"
              description="L'équipe Packio vous répond dans cette messagerie, en général sous un jour ouvré."
              action={createSupportRequestAction}
              submitLabel="Envoyer"
            >
              <TextField name="subject" label="Objet" required placeholder="Ex. : question sur ma facture" />
              <TextAreaField name="body" label="Message" required rows={5} />
            </ActionDialog>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {results ? (
            results.length ? (
              <ul className="divide-y">
                {results.map((r) => (
                  <li key={r.id}>
                    <Link href={`${basePath}?c=${r.conversationId}`} className="block px-4 py-3 hover:bg-muted/60" onClick={() => setQuery("")}>
                      <p className="text-xs text-muted-foreground">
                        {r.sender} · {formatRelative(r.createdAt)}
                      </p>
                      <p className="line-clamp-2 text-sm">{r.body}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Aucun message ne correspond.</p>
            )
          ) : conversations.length ? (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${basePath}?c=${c.id}`}
                    className={cn("flex gap-3 border-b px-4 py-3.5 transition-colors hover:bg-muted/50", selected?.id === c.id && "bg-brand-soft/50")}
                    aria-current={selected?.id === c.id ? "true" : undefined}
                  >
                    <Avatar className="size-10">
                      <AvatarFallback className={cn("text-xs font-semibold", c.type === "SUPPORT" ? "bg-foreground text-background" : "bg-brand-soft text-brand")}>{c.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.title}</p>
                        <span className="shrink-0 text-[0.7rem] text-muted-foreground">{formatRelative(c.lastMessageAt)}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{c.subtitle}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <p className={cn("min-w-0 flex-1 truncate text-xs", c.unread ? "text-foreground" : "text-muted-foreground")}>{c.preview ?? "Aucun message"}</p>
                        {c.unread > 0 && <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand px-1 text-[0.65rem] font-bold text-brand-foreground">{c.unread}</span>}
                        {c.status !== "OPEN" && <Archive className="size-3.5 text-muted-foreground" aria-label="Archivée" />}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <MessagesSquare className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">{props.emptyHint ?? "Aucune conversation pour le moment."}</p>
            </div>
          )}
        </div>
      </aside>
      <section className={cn("min-h-0 flex-col", selected ? "flex" : "hidden md:flex")}>
        {selected ? (
          <Thread key={selected.id} {...props} selected={selected} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <MessagesSquare className="size-6" />
            </span>
            <p className="font-medium">Sélectionnez une conversation</p>
            <p className="max-w-xs text-sm text-muted-foreground">Vos échanges sont privés et conservés pour le suivi de vos commandes et expéditions.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function Thread({ selected, me, basePath, orderHref, shipmentHref, adminControls }: Props & { selected: SelectedConversation }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ThreadMessage[]>(selected.messages);
  const [readAt, setReadAt] = useState<string | null>(selected.readAt);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState<{ type: "order" | "shipment"; id: string; label: string } | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastAt = messages.at(-1)?.createdAt;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
  }, []);

  const refresh = useCallback(async () => {
    const url = `/api/conversations/${selected.id}/messages${lastAt ? `?after=${encodeURIComponent(lastAt)}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { messages: ApiMessage[]; readAt: string | null };
    setReadAt(json.readAt);
    if (json.messages.length) {
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const added = json.messages
          .filter((m) => !known.has(m.id))
          .map((m) => ({ ...m, sender: m.sender ? { id: m.sender.id, name: `${m.sender.firstName} ${m.sender.lastName}`, role: m.sender.role } : null }));
        return [...prev, ...added];
      });
      if (selected.mode !== "supervision") markConversationReadAction(selected.id);
      scrollToBottom();
    }
  }, [selected.id, selected.mode, lastAt, scrollToBottom]);

  useEffect(scrollToBottom, [scrollToBottom]);

  useEffect(() => {
    const onMessage = (e: Event) => {
      const id = (e as CustomEvent<{ conversationId?: string }>).detail?.conversationId;
      if (!id || id === selected.id) refresh();
    };
    window.addEventListener("packio:message", onMessage);
    const poll = setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener("packio:message", onMessage);
      clearInterval(poll);
    };
  }, [refresh, selected.id]);

  async function attach(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    for (const f of Array.from(list).slice(0, 6 - attachments.length)) {
      try {
        const up = await uploadToPackio(f, "MESSAGE_ATTACHMENT");
        setAttachments((a) => [...a, up]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Échec du téléversement");
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function send() {
    if (sending || uploading || (!body.trim() && !attachments.length)) return;
    setSending(true);
    const res = await sendMessageAction({
      conversationId: selected.id,
      body,
      attachmentIds: attachments.map((a) => a.id),
      supplierOrderId: link?.type === "order" ? link.id : null,
      shipmentId: link?.type === "shipment" ? link.id : null,
    });
    setSending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setBody("");
    setAttachments([]);
    setLink(null);
    await refresh();
    router.refresh();
  }

  const grouped = useMemo(() => {
    const out: { day: Date; items: ThreadMessage[] }[] = [];
    for (const m of messages) {
      const d = new Date(m.createdAt);
      const last = out.at(-1);
      if (last && isSameDay(last.day, d)) last.items.push(m);
      else out.push({ day: d, items: [m] });
    }
    return out;
  }, [messages]);

  const lastMine = [...messages].reverse().find((m) => m.sender?.id === me.userId);

  return (
    <>
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Button asChild variant="ghost" size="icon" className="md:hidden" aria-label="Retour aux conversations">
          <Link href={basePath}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{selected.title}</p>
          <p className="truncate text-xs text-muted-foreground">{selected.subtitle}</p>
        </div>
        {selected.mode === "supervision" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs text-warning">
            <Eye className="size-3.5" /> Supervision
          </span>
        )}
        {adminControls && selected.type === "SUPPORT" && (
          <form action={async (fd) => void (await setSupportStatusAction(null, fd))}>
            <input type="hidden" name="conversationId" value={selected.id} />
            <input type="hidden" name="status" value={selected.status === "OPEN" ? "CLOSED" : "OPEN"} />
            <Button type="submit" variant="outline" size="sm" onClick={() => setTimeout(() => router.refresh(), 400)}>
              {selected.status === "OPEN" ? "Clôturer" : "Rouvrir"}
            </Button>
          </form>
        )}
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-muted/30 px-3 py-5 sm:px-6" aria-live="polite">
        {grouped.map((g) => (
          <div key={g.day.toISOString()} className="space-y-2.5">
            <p className="text-center text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">{dayLabel(g.day)}</p>
            {g.items.map((m) => {
              if (m.kind === "SYSTEM") {
                return (
                  <p key={m.id} className="mx-auto flex max-w-md items-start justify-center gap-1.5 text-center text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                    {m.body}
                  </p>
                );
              }
              const mine = m.sender?.id === me.userId;
              const isRead = mine && readAt && new Date(readAt) >= new Date(m.createdAt);
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] space-y-1 sm:max-w-[70%]", mine ? "items-end" : "items-start")}>
                    {!mine && m.sender && <p className="px-1 text-[0.7rem] text-muted-foreground">{m.sender.role === "ADMIN" ? "Équipe Packio" : m.sender.name}</p>}
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2.5 text-sm shadow-xs",
                        mine ? "rounded-br-md bg-brand text-brand-foreground" : "rounded-bl-md border bg-card text-card-foreground",
                      )}
                    >
                      {(m.supplierOrder || m.shipment) && (
                        <Link
                          href={m.supplierOrder ? `${orderHref ?? "#"}${m.supplierOrder.id}` : `${shipmentHref ?? "#"}${m.shipment!.id}`}
                          className={cn("mb-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium", mine ? "bg-white/15" : "bg-muted")}
                        >
                          {m.supplierOrder ? <Package className="size-3" /> : <Truck className="size-3" />}
                          {m.supplierOrder?.reference ?? m.shipment?.reference}
                        </Link>
                      )}
                      {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
                      {m.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.attachments.map((a) =>
                            a.mimeType.startsWith("image/") ? (
                              <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`/api/files/${a.id}`} alt={a.filename} className="max-h-48 max-w-full object-cover" loading="lazy" />
                              </a>
                            ) : (
                              <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs", mine ? "bg-white/15" : "bg-muted")}>
                                <FileText className="size-3.5" />
                                {a.filename}
                              </a>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                    <p className={cn("flex items-center gap-1 px-1 text-[0.65rem] text-muted-foreground", mine && "justify-end")}>
                      {format(new Date(m.createdAt), "HH:mm")}
                      {mine && m.id === lastMine?.id && (isRead ? <><CheckCheck className="size-3 text-brand" /> Lu</> : <><Check className="size-3" /> Envoyé</>)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {selected.canWrite ? (
        <div className="border-t bg-card p-3">
          {(attachments.length > 0 || link) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {link && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs text-brand">
                  <Link2 className="size-3" /> {link.label}
                  <button type="button" onClick={() => setLink(null)} aria-label="Retirer le lien">
                    <X className="size-3" />
                  </button>
                </span>
              )}
              {attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                  <Paperclip className="size-3" /> {a.filename}
                  <button type="button" onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))} aria-label={`Retirer ${a.filename}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {showLinks && (selected.linkables.orders.length > 0 || selected.linkables.shipments.length > 0) && (
            <div className="mb-2 grid max-h-40 gap-1 overflow-y-auto rounded-xl border p-2 text-sm">
              {selected.linkables.orders.map((o) => (
                <button key={o.id} type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted" onClick={() => (setLink({ type: "order", ...o }), setShowLinks(false))}>
                  <Package className="size-3.5 text-muted-foreground" /> {o.label}
                </button>
              ))}
              {selected.linkables.shipments.map((s) => (
                <button key={s.id} type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted" onClick={() => (setLink({ type: "shipment", ...s }), setShowLinks(false))}>
                  <Truck className="size-3.5 text-muted-foreground" /> {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex gap-0.5 pb-0.5">
              <Button type="button" variant="ghost" size="icon" onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="Joindre un fichier">
                {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
              </Button>
              {(selected.linkables.orders.length > 0 || selected.linkables.shipments.length > 0) && (
                <Button type="button" variant="ghost" size="icon" onClick={() => setShowLinks((s) => !s)} aria-label="Associer une commande ou une expédition">
                  <Plus />
                </Button>
              )}
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Écrire un message…"
              rows={1}
              className="max-h-40 min-h-10 resize-none"
              aria-label="Message"
            />
            <Button type="button" onClick={send} disabled={sending || uploading || (!body.trim() && !attachments.length)} size="icon-lg" aria-label="Envoyer">
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => attach(e.target.files)} tabIndex={-1} />
        </div>
      ) : (
        <p className="border-t bg-muted/40 px-4 py-3 text-center text-xs text-muted-foreground">
          {selected.mode === "supervision" ? "Accès de supervision en lecture seule, journalisé." : "Cette conversation est archivée : elle reste consultable mais vous ne pouvez plus y répondre."}
        </p>
      )}
    </>
  );
}
