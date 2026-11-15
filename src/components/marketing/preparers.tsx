import { Camera, Eye, Lock, MapPin, MessagesSquare, Ruler, Truck, UserRoundCheck, Warehouse } from "lucide-react";
import { Container, SectionHeading } from "./section";

const TASKS = [
  { icon: MapPin, title: "Récupération aux lockers et points relais", text: "Il retire vos colis au point de réception validé, avec le code de retrait que vous lui transmettez." },
  { icon: Camera, title: "Contrôle et photos", text: "Quantités vérifiées, état contrôlé, photos à la réception : un défaut est signalé immédiatement." },
  { icon: Warehouse, title: "Stockage organisé", text: "Chaque article reçoit une référence interne et un emplacement. Le stock est inventorié régulièrement." },
  { icon: Ruler, title: "Préparation et classification", text: "Il emballe vos expéditions et détermine la taille réelle du colis selon les règles définies par Packio." },
  { icon: Truck, title: "Dépôt et suivi", text: "Il dépose le colis chez le transporteur et renseigne le numéro de suivi dans votre espace." },
  { icon: MessagesSquare, title: "Échanges directs", text: "Il vous répond dans la messagerie et vous tient informé à chaque étape importante." },
];

export function Preparers() {
  return (
    <section id="preparateurs" className="scroll-mt-20 overflow-hidden border-y bg-muted/30 py-24 sm:py-28">
      <Container className="grid items-center gap-14 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-10">
          <SectionHeading
            align="left"
            eyebrow="Préparateurs"
            title="Une personne identifiée, dédiée à vos colis"
            description="Votre préparateur attitré est un professionnel du réseau Packio. Il ne s'agit pas d'un entrepôt anonyme : vous savez qui manipule vos articles et vous pouvez lui écrire à tout moment."
          />
          <ul className="grid gap-5 sm:grid-cols-2">
            {TASKS.map((t) => (
              <li key={t.title} className="flex gap-3.5">
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
        <div className="relative">
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
              <div className="rounded-2xl border bg-card p-5">
                <UserRoundCheck className="size-5 text-brand" />
                <p className="mt-3 text-sm font-semibold">Attribution manuelle</p>
                <p className="mt-1 text-sm text-muted-foreground">L&apos;équipe Packio choisit votre préparateur selon sa disponibilité et sa capacité. Aucun algorithme ne décide à sa place.</p>
              </div>
              <div className="rounded-2xl border bg-card p-5">
                <Lock className="size-5 text-brand" />
                <p className="mt-3 text-sm font-semibold">Données protégées</p>
                <p className="mt-1 text-sm text-muted-foreground">Vous ne voyez que les informations utiles au service ; ses coordonnées personnelles restent confidentielles, comme les vôtres.</p>
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
