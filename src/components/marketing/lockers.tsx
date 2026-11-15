import { ArrowRight, Building2, KeyRound, MapPin, PackageCheck, ShieldCheck, ShoppingBag, Store, TriangleAlert } from "lucide-react";
import type { LocationType } from "@/generated/prisma/enums";
import { LOCATION_TYPE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Container, SectionHeading } from "./section";

type Supplier = { code: string; name: string; acceptedLocationTypes: LocationType[]; compatibilityNotes: string | null; requiresPickupCode: boolean };

const FLOW = [
  { icon: ShoppingBag, title: "Vous commandez", text: "Chez le fournisseur, en livraison vers le point indiqué dans votre espace." },
  { icon: MapPin, title: "Point validé", text: "Adresse professionnelle, locker ou point relais vérifié par Packio." },
  { icon: KeyRound, title: "Code de retrait", text: "Pour un locker, vous transmettez le code reçu à votre préparateur." },
  { icon: PackageCheck, title: "Récupération", text: "Le préparateur retire le colis, le contrôle et le met en stock." },
];

const TYPE_ICON: Record<LocationType, typeof Building2> = { BUSINESS_ADDRESS: Building2, LOCKER: Store, RELAY_POINT: MapPin };

export function Lockers({ suppliers }: { suppliers: Supplier[] }) {
  return (
    <section id="lockers" className="scroll-mt-20 py-24 sm:py-28">
      <Container className="space-y-14">
        <SectionHeading
          eyebrow="Lockers et points de réception"
          title="Des adresses de réception vérifiées, compatibles avec vos fournisseurs"
          description="Packio ne vous communique que des points de réception validés par son équipe. Avant chaque commande, la plateforme vérifie que le fournisseur choisi livre bien vers ce type de point."
        />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((f, i) => (
            <li key={f.title} className="relative rounded-2xl border bg-card p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <f.icon className="size-4" />
                </span>
                <span className="text-xs font-medium text-muted-foreground tabular">0{i + 1}</span>
              </div>
              <p className="mt-4 font-semibold">{f.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
              {i < FLOW.length - 1 && <ArrowRight className="absolute top-1/2 -right-3 z-10 hidden size-5 -translate-y-1/2 rounded-full bg-background p-0.5 text-muted-foreground ring-1 ring-border lg:block" aria-hidden />}
            </li>
          ))}
        </ol>
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
              <p className="font-semibold">Compatibilité par fournisseur</p>
              <span className="text-xs text-muted-foreground">Règles mises à jour par l&apos;équipe Packio</span>
            </div>
            <ul className="divide-y">
              {suppliers.map((s) => (
                <li key={s.code} className="grid gap-3 px-5 py-4 sm:grid-cols-[9rem_1fr]">
                  <p className="font-medium">{s.name}</p>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {(["BUSINESS_ADDRESS", "LOCKER", "RELAY_POINT"] as LocationType[]).map((t) => {
                        const ok = s.acceptedLocationTypes.includes(t);
                        const Icon = TYPE_ICON[t];
                        return (
                          <span
                            key={t}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset",
                              ok ? "bg-success-soft text-success ring-success/20" : "bg-muted text-muted-foreground/70 line-through ring-border",
                            )}
                          >
                            <Icon className="size-3" /> {LOCATION_TYPE[t]}
                          </span>
                        );
                      })}
                    </div>
                    {s.compatibilityNotes && <p className="text-sm leading-relaxed text-muted-foreground">{s.compatibilityNotes}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border bg-card p-5 shadow-soft">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sur l&apos;étiquette du colis</p>
              <p className="mt-3 rounded-xl bg-muted/70 px-3 py-2.5 font-mono text-sm">Camille M. — PK-XXXXX</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Le nom du destinataire est suivi de votre <span className="font-medium text-foreground">code client</span> : votre préparateur identifie votre colis dès sa réception.
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <ShieldCheck className="size-5 text-brand" />
              <p className="mt-3 text-sm font-semibold">Seulement des adresses utilisables</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Un point de réception n&apos;apparaît dans votre espace qu&apos;après validation. S&apos;il change, il doit être revalidé.</p>
            </div>
            <div className="flex gap-3 rounded-2xl border border-warning/30 bg-warning-soft/60 p-4 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="leading-relaxed text-foreground/80">Les options de livraison dépendent de chaque fournisseur et parfois de chaque vendeur : vérifiez-les au moment de l&apos;achat.</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
