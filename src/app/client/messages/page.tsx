import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { MessagingView } from "@/components/messaging/messaging-view";
import { requireCustomer } from "@/server/auth/current";
import { loadMessagingData } from "@/server/messaging-page";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Messages" };

export default async function ClientMessagesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireCustomer();
  const sp = await searchParams;
  const { conversations, selected } = await loadMessagingData(actor, one(sp.c));
  return (
    <div className="space-y-4">
      <PageHeader title="Messages" description="Échangez avec votre préparateur et avec le support Packio." className="mb-4 sm:mb-5" />
      <MessagingView
        basePath="/client/messages"
        me={{ userId: actor.userId }}
        conversations={conversations}
        selected={selected}
        orderHref="/client/commandes/"
        shipmentHref="/client/expeditions/"
        allowNewSupport
        openSupportDialog={one(sp.support) === "1"}
        emptyHint="La conversation avec votre préparateur s'ouvrira dès son attribution."
      />
    </div>
  );
}
