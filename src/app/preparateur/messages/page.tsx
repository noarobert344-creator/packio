import type { Metadata } from "next";
import { requirePreparer } from "@/server/auth/current";
import { loadMessagingData } from "@/server/messaging-page";
import { MessagingView } from "@/components/messaging/messaging-view";
import { PageHeader } from "@/components/shared/page-header";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Messages" };

export default async function PreparerMessagesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePreparer();
  const sp = await searchParams;
  const { conversations, selected } = await loadMessagingData(actor, one(sp.c));
  return (
    <div>
      <PageHeader title="Messages" description="Échangez avec vos clients et avec le support Packio." className="mb-4 sm:mb-5" />
      <MessagingView
        basePath="/preparateur/messages"
        me={{ userId: actor.userId }}
        conversations={conversations}
        selected={selected}
        orderHref="/preparateur/receptions/"
        shipmentHref="/preparateur/expeditions/"
        allowNewSupport
        openSupportDialog={one(sp.support) === "1"}
        emptyHint="Les conversations avec vos clients s'ouvrent automatiquement lors de leur attribution."
      />
    </div>
  );
}
