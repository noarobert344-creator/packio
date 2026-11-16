import { MessageCircle, Package, Star } from "lucide-react";
import { Container, SectionHeading } from "./section";

/**
 * Avis laissés par des clients sur le serveur Discord de Packio, reproduits tels
 * quels. À tenir à jour : uniquement de vrais avis, et un nombre de colis exact
 * (pratiques commerciales trompeuses, article L. 111-7-2 du Code de la consommation).
 */
const REVIEWS = [
  "J'ai même plus besoin de faire mes colis je perdais trop de temps avec tous les cours mais maintenant packio fait tout",
  "Franchement ya rien de mieux la je peux voyager et je fais de l'achat revente depuis mon téléphone c'est Génial !",
  "Trop bien le préparateur est agréable et jamais eu de problèmes",
  "Franchement tout est parfait ça m'a permis de m'expatrier merci packio!!",
];
const FEATURED = "Je peux voyager et je fais de l'achat revente depuis mon téléphone.";
const RATING = "5/5";
const PARCELS = "+1 500";

function Stars({ className = "size-4" }: { className?: string }) {
  return (
    <span className="inline-flex gap-0.5 text-amber-400" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={`${className} fill-current`} />
      ))}
    </span>
  );
}

export function Testimonials() {
  // Quatre copies : la boucle reste continue même sur un très grand écran.
  const loop = [...REVIEWS, ...REVIEWS, ...REVIEWS, ...REVIEWS];
  return (
    <section id="avis" className="scroll-mt-20 overflow-hidden py-24 sm:py-28">
      <Container className="space-y-10">
        <SectionHeading eyebrow="Avis" title="Ils ont délégué leurs colis" />
        <div data-reveal className="flex flex-col items-center gap-8">
          <div className="inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-2xl border sm:rounded-full bg-card/70 px-5 py-2.5 text-sm shadow-soft backdrop-blur">
            <span className="inline-flex items-center gap-2">
              <Stars />
              <span className="font-semibold">{RATING}</span>
              <span className="sr-only">étoiles</span>
            </span>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <span className="inline-flex items-center gap-2">
              <Package className="size-4 text-brand" />
              <span>
                <span className="font-semibold">{PARCELS}</span> colis préparés
              </span>
            </span>
          </div>
          <p className="max-w-3xl text-center text-2xl font-semibold tracking-tight text-balance sm:text-3xl">« {FEATURED} »</p>
        </div>
      </Container>
      <div data-reveal className="marquee mt-12">
        <div className="mask-fade-x overflow-hidden">
          <ul className="flex w-max animate-marquee gap-4 py-2 [animation-duration:70s]">
            {loop.map((text, i) => (
              <li
                key={i}
                aria-hidden={i >= REVIEWS.length}
                className="flex w-[18rem] shrink-0 flex-col justify-between gap-5 rounded-2xl border bg-card p-5 shadow-soft sm:w-[22rem]"
              >
                <div className="space-y-3">
                  <Stars className="size-3.5" />
                  <p className="text-[0.95rem] leading-relaxed">{text}</p>
                </div>
                <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <MessageCircle className="size-4" />
                  </span>
                  Client Packio, sur Discord
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Container>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Avis laissés par nos clients sur le serveur Discord de Packio et reproduits tels quels, sans procédure de vérification automatisée.
        </p>
      </Container>
    </section>
  );
}
