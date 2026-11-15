"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/server/actions/account";
import { useRealtime } from "./realtime";

type Item = { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export function NotificationBell({ settingsHref }: { settingsHref: string }) {
  const { unreadNotifications } = useRealtime();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [localUnread, setLocalUnread] = useState<number | null>(null);
  const unread = localUnread ?? unreadNotifications;

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { items: Item[]; unread: number };
        setItems(json.items);
        setLocalUnread(null);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popover onOpenChange={(o) => o && load()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? ` (${unread} non lues)` : ""}`}>
          <Bell className="size-[1.15rem]" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.6rem] font-bold text-brand-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,24rem)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <Button
            variant="ghost"
            size="xs"
            onClick={async () => {
              await markAllNotificationsReadAction();
              setItems((prev) => prev?.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) ?? null);
              setLocalUnread(0);
            }}
          >
            <CheckCheck /> Tout marquer comme lu
          </Button>
        </div>
        <ScrollArea className="max-h-[26rem]">
          {loading && !items ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : items && items.length ? (
            <ul className="divide-y">
              {items.map((n) => {
                const content = (
                  <div className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-muted/60", !n.readAt && "bg-brand-soft/40")}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                      <p className="text-[0.7rem] text-muted-foreground/80">{formatRelative(n.createdAt)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} onClick={() => !n.readAt && markNotificationReadAction(n.id)}>
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Aucune notification pour le moment.</p>
          )}
        </ScrollArea>
        <div className="border-t px-4 py-2.5 text-right">
          <Link href={settingsHref} className="text-xs text-muted-foreground hover:text-foreground">
            Préférences de notification
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
