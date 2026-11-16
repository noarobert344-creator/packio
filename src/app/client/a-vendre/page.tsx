import type { Metadata } from "next";
import Link from "next/link";
import { Camera, Download, ExternalLink, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { listForSale } from "@/server/queries/sales-board";
import { MARKETPLACE_PLATFORM } from "@/lib/labels";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "À vendre" };

export default async function CustomerForSalePage() {
  const { customer } = await requireSubscribedCustomer();
  const { ready, toShoot } = await listForSale({ customerId: customer.id });
  return (
    <div className="space-y-6">
      <PageHeader
        title="À vendre"
        description="Votre préparateur photographie vos articles en stock et les dépose ici. Téléchargez les photos et créez votre annonce. Quand l'article se vend, la vente arrive dans « Toutes mes ventes » : choisissez « Vente normale »."
        actions={
          <Button asChild variant="outline">
            <Link href="/client/bordereaux">Bordereaux</Link>
          </Button>
        }
      />
      {ready.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ready.map((item) => {
            const live = item.listings.filter((l) => l.status !== "sold");
            const sold = item.listings.some((l) => l.status === "sold");
            return (
              <article key={item.id} className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft">
                <div className="relative aspect-[4/3] bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${item.files[0].id}`} alt={item.name} className="size-full object-cover" loading="lazy" />
                  <span className="absolute right-2 bottom-2 rounded-full bg-background/85 px-2 py-0.5 text-xs font-medium">
                    {item.files.length} photo{item.files.length > 1 ? "s" : ""}
                  </span>
                </div>
                {item.files.length > 1 && (
                  <div className="flex gap-1.5 overflow-x-auto px-3 pt-3">
                    {item.files.slice(1, 6).map((f) => (
                      <a key={f.id} href={`/api/files/${f.id}?telecharger`} className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted" title="Télécharger cette photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${f.id}`} alt="" className="size-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/client/stock/${item.id}`} className="font-medium hover:underline">
                      {item.name}
                    </Link>
                    {sold ? (
                      <span className="shrink-0 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Vendu</span>
                    ) : live.length ? (
                      <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">En ligne</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">À publier</span>
                    )}
                  </div>
                  {live.map((l) =>
                    l.url ? (
                      <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                        {MARKETPLACE_PLATFORM[l.platform]} : {l.title} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <p key={l.id} className="text-xs text-muted-foreground">
                        {MARKETPLACE_PLATFORM[l.platform]} : {l.title}
                      </p>
                    ),
                  )}
                  <p className="text-xs text-muted-foreground">
                    {item.quantityAvailable} en stock{item.photosUpdatedAt ? ` · photos du ${formatDate(item.photosUpdatedAt)}` : ""}
                  </p>
                  <Button asChild className="mt-auto">
                    <a href={`/api/stock/${item.id}/photos`} download>
                      <Download /> Télécharger les photos
                    </a>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Tag} title="Aucun article en vente pour le moment" description="Dès que votre préparateur photographie un article, il apparaît ici avec ses photos." />
      )}
      {toShoot.length > 0 && (
        <Section title="En attente de photos" description="Votre préparateur va photographier ces articles ; vous serez prévenu.">
          <ul className="divide-y">
            {toShoot.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Camera className="size-4 shrink-0 text-muted-foreground" />
                  <Link href={`/client/stock/${item.id}`} className="truncate hover:underline">
                    {item.name}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
