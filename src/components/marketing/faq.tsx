import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { Settings } from "@/server/services/settings";
import { durationLabel } from "./pricing";
import { Container, SectionHeading } from "./section";

export type FaqContext = {
  slaHours: number;
  monthlyPolicy: "EXPIRE" | "ROLLOVER";
  rolloverMonths: number;
  purchasedPolicy: "NEVER" | "EXPIRE_AFTER_DAYS";
  purchasedDays: number;
  storage: { name: string; limit: number | null }[];
  sizes: { label: string; cost: number }[];
  storageRules: Settings["storage"];
  shippingHours: number;
  returnCredits: number;
  /** Avantage de la formule annuelle (« 1 mois offert »), null si non proposée. */
  annualBadge: string | null;
};

export function Faq({ ctx }: { ctx: FaqContext }) {
  const sizes = ctx.sizes.map((s) => `${s.label.toLowerCase()} : ${s.cost} crédit${s.cost > 1 ? "s" : ""}`).join(", ");
  const storage = ctx.storage.map((s) => `${s.name} : ${s.limit === null ? "illimité" : `${s.limit} articles`}`).join(" · ");
  const r = ctx.storageRules;
  const extension = `${r.extensionCredits} crédit${r.extensionCredits > 1 ? "s" : ""}`;
  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: "Comment mon préparateur est-il choisi ?",
      a: (
        <>
          L&apos;attribution est toujours manuelle : après votre paiement, l&apos;équipe Packio choisit un préparateur selon sa disponibilité, sa capacité et sa localisation,
          sous {ctx.slaHours} heures. Vous êtes notifié dès que c&apos;est fait. Si ce délai ne peut pas être tenu, vous en êtes informé et l&apos;attribution est traitée en priorité.
        </>
      ),
    },
    {
      q: "Qu'est-ce qu'un crédit ?",
      a: (
        <>
          Un crédit rémunère la préparation d&apos;un colis : réception, stockage, emballage et dépôt. Le coût dépend de la taille du colis expédié ({sizes}). Les
          crédits servent aussi à prolonger le stockage d&apos;un article ou à ajouter des places. Votre abonnement inclut un nombre de crédits chaque mois ; vous
          pouvez en racheter à tout moment.
        </>
      ),
    },
    {
      q: "Combien d'articles puis-je stocker ?",
      a: `Le nombre de places dépend de votre offre (${storage}) : c'est le nombre d'articles stockés en même temps, commandes en cours d'acheminement comprises (hors dropshipping, qui ne prend aucune place). Pour aller au-delà, ajoutez des places avec vos crédits (1 crédit = ${r.slotsPerCredit} place${r.slotsPerCredit > 1 ? "s" : ""} pendant ${durationLabel(r.extraSlotsDays)}), expédiez des articles ou passez à l'offre supérieure.`,
    },
    {
      q: "Le dropshipping prend-il de la place dans mon stock ?",
      a: "Non. Un article commandé en dropshipping est expédié à votre acheteur dès sa réception par votre préparateur : il ne prend aucune place de stock et n'a pas de durée de stockage. Seuls les crédits d'expédition sont utilisés, selon la taille du colis.",
    },
    {
      q: "Combien de temps un article peut-il rester en stock ?",
      a:
        r.extensionCredits > 0
          ? `Chaque article dispose de ${durationLabel(r.includedDays)} de stockage incluses. Au-delà, ${extension} par article est prélevé automatiquement pour ${durationLabel(r.extensionDays)} de plus${r.reminderDaysBefore > 0 ? ` ; vous êtes prévenu ${durationLabel(r.reminderDaysBefore)} avant` : ""}. Si votre solde ne suffit pas, l'article passe « en dépassement » et la prolongation est prélevée dès que vous avez des crédits ; vous pouvez aussi l'expédier ou vous le faire renvoyer.`
          : `Chaque article dispose de ${durationLabel(r.includedDays)} de stockage incluses, prolongées par périodes de ${durationLabel(r.extensionDays)}.`,
    },
    {
      q: "Puis-je utiliser Packio depuis l'étranger ?",
      a: "Oui. Votre stock reste en France chez votre préparateur : vous achetez, vendez et suivez vos colis depuis votre téléphone, où que vous soyez. Packio est une solution pour s'expatrier ou voyager tout en continuant l'achat-revente.",
    },
    {
      q: "Les frais de port sont-ils inclus ?",
      a: "Non. Les crédits couvrent la préparation ; l'affranchissement est distinct : vous fournissez votre propre étiquette (celle de Vinted, par exemple), ou les frais vous sont indiqués séparément.",
    },
    {
      q: "Puis-je me faire renvoyer un article ?",
      a: `Oui. Depuis la fiche de l'article, demandez son retour à votre adresse : cela coûte ${ctx.returnCredits} crédit${ctx.returnCredits > 1 ? "s" : ""}, quelle que soit la taille du colis. Les frais de port sont à votre charge : vous joignez un bordereau prépayé, que votre préparateur imprime avant de déposer le colis.`,
    },
    {
      q: "Qu'est-ce que Packio Connect ?",
      a: "Une extension Chrome (bêta) qui relie vos comptes Vinted et Vestiaire Collective à Packio : vos ventes arrivent dans votre espace avec leur bordereau, que votre préparateur n'a plus qu'à imprimer. Elle utilise vos sessions déjà ouvertes, ne connaît jamais vos mots de passe et se déconnecte à tout moment. Les plateformes ne proposant pas d'accès officiel, vous restez responsable du respect de leurs conditions d'utilisation.",
    },
    {
      q: "Comment résilier ou changer d'offre ?",
      a: "Depuis votre espace (Facturation, puis Changer d'offre). Une offre supérieure ou le passage à l'annuel s'appliquent immédiatement, avec un nouveau paiement : votre offre précédente n'est plus renouvelée et ses crédits restent utilisables. Une offre inférieure prend effet à votre prochain renouvellement. Le retour au mensuel se fait à l'échéance de votre année. La résiliation prend effet à la fin de la période payée. Votre stock reste consultable et sa restitution est organisée avec le support.",
    },
  ];
  return (
    <section id="faq" className="scroll-mt-20 border-y bg-muted/30 py-24 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeading align="left" eyebrow="FAQ" title="Questions fréquentes" description="Le détail des règles figure dans votre espace et dans nos conditions générales." />
        <Accordion type="single" collapsible data-reveal className="rounded-2xl border bg-card px-5 shadow-soft sm:px-6">
          {items.map((it, i) => (
            <AccordionItem key={it.q} value={`q${i}`}>
              <AccordionTrigger className="py-4 text-left text-[0.95rem] font-medium hover:no-underline">{it.q}</AccordionTrigger>
              <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">{it.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Container>
    </section>
  );
}
