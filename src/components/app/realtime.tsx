"use client";

import { createContext, use, useEffect, useState } from "react";

type RealtimeState = { unreadNotifications: number; lastMessageAt: number; lastConversationId: string | null };

const RealtimeContext = createContext<RealtimeState>({ unreadNotifications: 0, lastMessageAt: 0, lastConversationId: null });

export function useRealtime() {
  return use(RealtimeContext);
}

/** Connexion SSE unique par onglet ; diffuse les événements aux composants. */
export function RealtimeProvider({ initialUnread, children }: { initialUnread: number; children: React.ReactNode }) {
  const [state, setState] = useState<RealtimeState>({ unreadNotifications: initialUnread, lastMessageAt: 0, lastConversationId: null });

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/realtime");
    source.addEventListener("notifications", (e) => {
      const { unread } = JSON.parse((e as MessageEvent).data) as { unread: number };
      setState((s) => ({ ...s, unreadNotifications: unread }));
    });
    source.addEventListener("message", (e) => {
      const { conversationId } = JSON.parse((e as MessageEvent).data) as { conversationId?: string };
      setState((s) => ({ ...s, lastMessageAt: Date.now(), lastConversationId: conversationId ?? null }));
      window.dispatchEvent(new CustomEvent("packio:message", { detail: { conversationId } }));
    });
    return () => source.close();
  }, []);

  return <RealtimeContext value={state}>{children}</RealtimeContext>;
}
