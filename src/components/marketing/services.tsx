import { Camera, Home, PlugZap, Timer, Zap } from "lucide-react";
import { Container, SectionHeading } from "./section";

/** Services complémentaires inclus dans l'offre (présentation, sans chiffres inventés). */
export function Services({ shippingHours, returnCredits }: { shippingHours: number; returnCredits: number }) {
  const services = [
    {
      icon: Timer,
      title: `Expédition sous ${shippingHours} h`,
      text: `Chaque colis est déposé chez le transporteur dans les ${shippingHours} heures suivant votre demande.`,
    },
    {
      icon: Zap,
      title: "Dropshipping Vinted",
      text: "Article vendu mais pas encore reçu ? Commandez-le sur Temu, SHEIN ou AliExpress : il part chez l'acheteur dès réception.",
    },
    {
      icon: Camera,
      title: "Photos pour vos annonces",
      text: "Votre préparateur photographie vos articles : publiez vos annonces sans les avoir sous la main.",
    },
    {
      icon: Home,
      title: "Retour à domicile",
      text: `Besoin de récupérer un article ? Demandez son renvoi chez vous pour ${returnCredits} crédit${returnCredits > 1 ? "s" : ""}, avec votre propre bordereau prépayé.`,
    },
  ];
  return (
    <section id="services" className="scroll-mt-20 py-24 sm:py-28">
      <Container className="space-y-14">
        <SectionHeading eyebrow="Services" title="Pensé pour les revendeurs Vinted et e-commerce" description="Packio s'occupe des tâches qui vous font perdre le plus de temps." />
        <ul className="grid gap-4 sm:grid-cols-2">
          {services.map((s, i) => (
            <li key={s.title} data-reveal style={{ "--d": `${(i % 2) * 90}ms` } as React.CSSProperties}>
              <div data-spotlight className="flex h-full gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:p-6">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <s.icon className="size-[1.1rem]" />
                </span>
                <div>
                  <p className="font-semibold">{s.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div data-reveal className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-brand-soft/80 via-card to-card p-6 shadow-soft sm:p-8">
          <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
            <div className="flex gap-4">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground">
                <PlugZap className="size-5" />
              </span>
              <div>
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                  Packio Connect
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand ring-1 ring-brand/20 ring-inset">Bêta</span>
                </p>
                <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  L&apos;extension Chrome qui relie vos comptes Vinted et Vestiaire Collective : chaque vente arrive dans Packio avec son bordereau, prêt à imprimer chez
                  votre préparateur.
                </p>
              </div>
            </div>
            <ul className="grid gap-1.5 text-sm text-muted-foreground lg:min-w-56">
              <li>Vente détectée automatiquement</li>
              <li>Bordereau joint à l&apos;expédition</li>
              <li>Comptes Vinted et Vestiaire Collective</li>
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}
