import { Boxes, Clock3, Coins, LockKeyhole, MessagesSquare, ShieldCheck } from "lucide-react";
import { Container, SectionHeading } from "./section";

const BENEFITS = [
  { icon: Clock3, title: "Du temps pour vendre", text: "Plus de files d'attente au point relais ni de cartons à préparer : vous vous concentrez sur vos ventes." },
  { icon: Boxes, title: "Un stock toujours visible", text: "Photos, quantités disponibles, réservées et expédiées, emplacement : tout est à jour dans votre espace." },
  { icon: Coins, title: "Des crédits transparents", text: "Un coût fixe par taille de colis, réservé puis débité au dépôt. Chaque mouvement figure dans votre historique." },
  { icon: MessagesSquare, title: "Un lien direct", text: "Une messagerie privée avec votre préparateur, liée à vos commandes et expéditions, et un support Packio dédié." },
  { icon: ShieldCheck, title: "Paiements sécurisés", text: "Abonnement, crédits supplémentaires et reçus gérés par Whop. Packio ne stocke jamais vos données de carte." },
  { icon: LockKeyhole, title: "Données protégées", text: "Accès strictement limités par rôle, fichiers privés, journal d'audit des actions sensibles, droits RGPD respectés." },
];

export function Benefits() {
  return (
    <section className="scroll-mt-20 border-y bg-muted/30 py-24 sm:py-28">
      <Container className="space-y-14">
        <SectionHeading eyebrow="Avantages" title="Tout ce qu'il faut pour déléguer en confiance" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <li key={b.title} className="group flex gap-4 rounded-2xl border bg-card p-5 shadow-soft transition-colors hover:border-brand/30 sm:block sm:p-6">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand transition-transform group-hover:-translate-y-0.5">
                <b.icon className="size-[1.1rem]" />
              </span>
              <div>
                <p className="font-semibold sm:mt-5">{b.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground sm:mt-2">{b.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
