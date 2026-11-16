import { Camera, Eye, Lock, MapPin, Truck, UserRoundCheck, Warehouse } from "lucide-react";
import { Container, SectionHeading } from "./section";

export function Preparers({ shippingHours }: { shippingHours: number }) {
  const TASKS = [
    { icon: MapPin, title: "Récupération des colis", text: "Au point de réception validé, avec votre code de retrait." },
    { icon: Camera, title: "Contrôle et photos", text: "État vérifié et photos prêtes pour vos annonces." },
    { icon: Warehouse, title: "Stockage organisé", text: "Une référence et un emplacement pour chaque article." },
    { icon: Truck, title: `Dépôt sous ${shippingHours} h`, text: "Colis emballé, déposé et suivi jusqu'à l'acheteur." },
  ];
  return (
    <section id="preparateurs" className="scroll-mt-20 overflow-hidden border-y bg-muted/30 py-24 sm:py-28">
      <Container className="grid items-center gap-14 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-10">
          <SectionHeading
            align="left"
            eyebrow="Préparateurs"
            title="Une personne identifiée, dédiée à vos colis"
            description="Pas un entrepôt anonyme : un professionnel du réseau Packio, que vous connaissez et à qui vous écrivez directement."
          />
          <ul className="grid gap-5 sm:grid-cols-2">
            {TASKS.map((t, i) => (
              <li key={t.title} data-reveal className="flex gap-3.5" style={{ "--d": `${i * 80}ms` } as React.CSSProperties}>
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-brand shadow-soft ring-1 ring-border">
                  <t.icon className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative" data-reveal="right">
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-dots opacity-60 mask-radial" aria-hidden />
          <div className="space-y-4">
            <div className="rounded-2xl border bg-card p-5 shadow-soft">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ce que vous voyez de votre préparateur</p>
              <div className="mt-4 flex items-center gap-4">
                <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">CM</span>
                <div>
                  <p className="font-semibold">Camille M.</p>
                  <p className="text-sm text-muted-foreground">Lyon · Disponible</p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-muted/60 p-3">
                  <dt className="text-xs text-muted-foreground">Point de réception</dt>
                  <dd className="mt-0.5 font-medium">Adresse validée</dd>
                </div>
                <div className="rounded-xl bg-muted/60 p-3">
                  <dt className="text-xs text-muted-foreground">Colis confiés</dt>
                  <dd className="mt-0.5 font-medium">Historique complet</dd>
                </div>
              </dl>
              <p className="mt-4 text-[0.7rem] text-muted-foreground">Illustration — données d&apos;exemple</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div data-spotlight className="rounded-2xl border bg-card p-5">
                <UserRoundCheck className="size-5 text-brand" />
                <p className="mt-3 text-sm font-semibold">Attribution manuelle</p>
                <p className="mt-1 text-sm text-muted-foreground">Choisi par l&apos;équipe Packio selon sa disponibilité, pas par un algorithme.</p>
              </div>
              <div data-spotlight className="rounded-2xl border bg-card p-5">
                <Lock className="size-5 text-brand" />
                <p className="mt-3 text-sm font-semibold">Données protégées</p>
                <p className="mt-1 text-sm text-muted-foreground">Ses coordonnées personnelles restent confidentielles, comme les vôtres.</p>
              </div>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Eye className="size-3.5" /> Le préparateur n&apos;accède qu&apos;aux clients qui lui sont attribués.
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
