import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Container, SectionHeading } from "./section";

export type FaqContext = {
  slaHours: number;
  monthlyPolicy: "EXPIRE" | "ROLLOVER";
  rolloverMonths: number;
  purchasedPolicy: "NEVER" | "EXPIRE_AFTER_DAYS";
  purchasedDays: number;
  storage: { name: string; limit: number | null }[];
  sizes: { label: string; cost: number }[];
};

export function Faq({ ctx }: { ctx: FaqContext }) {
  const sizes = ctx.sizes.map((s) => `${s.label.toLowerCase()} : ${s.cost} crédit${s.cost > 1 ? "s" : ""}`).join(", ");
  const storage = ctx.storage.map((s) => `${s.name} : ${s.limit === null ? "illimité" : `${s.limit} articles`}`).join(" · ");
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
          Un crédit rémunère la préparation d&apos;un colis : réception, stockage, emballage et dépôt. Le coût dépend de la taille du colis expédié ({sizes}). Votre
          abonnement inclut un nombre de crédits chaque mois ; vous pouvez en racheter à tout moment.
        </>
      ),
    },
    {
      q: "Qui détermine la taille de mon colis ?",
      a: "Uniquement votre préparateur, une fois le colis préparé, en appliquant les dimensions et poids maximaux définis par Packio pour chaque catégorie. Vous recevez une notification avec la catégorie retenue. En cas de désaccord, vous pouvez contester la classification depuis la fiche de l'expédition : l'équipe Packio vérifie et corrige si nécessaire.",
    },
    {
      q: "Quand mes crédits sont-ils débités ?",
      a: "Les crédits sont réservés lorsque le préparateur classe le colis, puis définitivement débités lorsqu'il le dépose chez le transporteur. Si vous annulez avant le début de la préparation, les crédits réservés sont libérés immédiatement. Un même colis ne peut jamais être débité deux fois.",
    },
    {
      q: "Que se passe-t-il si mon solde est insuffisant ?",
      a: "L'expédition passe « En attente de crédits » et vous êtes prévenu. Dès que vous rechargez votre portefeuille ou que vos crédits mensuels sont renouvelés, elle reprend automatiquement, dans l'ordre de vos demandes.",
    },
    {
      q: "Mes crédits non utilisés sont-ils perdus ?",
      a: (
        <>
          {ctx.monthlyPolicy === "EXPIRE"
            ? "Selon la politique en vigueur, les crédits mensuels non utilisés expirent au renouvellement de votre abonnement."
            : `Selon la politique en vigueur, les crédits mensuels non utilisés sont reportés pendant ${ctx.rolloverMonths} mois, dans la limite d'un plafond.`}{" "}
          {ctx.purchasedPolicy === "NEVER"
            ? "Les crédits achetés en recharge n'expirent pas tant que votre compte est actif."
            : `Les crédits achetés en recharge restent valables ${ctx.purchasedDays} jours.`}{" "}
          Les échéances à venir sont toujours affichées dans votre espace.
        </>
      ),
    },
    {
      q: "Puis-je commander chez n'importe quel fournisseur ?",
      a: "Vinted, SHEIN, AliExpress, ZenMarket et la plupart des boutiques en ligne sont utilisables. Tous les fournisseurs ne livrent cependant pas vers tous les lockers ou points relais : Packio vérifie la compatibilité entre le fournisseur et le point de réception avant d'enregistrer votre commande, et vous propose l'adresse adaptée.",
    },
    {
      q: "Comment fonctionne la réception en locker ?",
      a: "Commandez en livraison vers le locker de votre préparateur en indiquant le nom de destinataire affiché dans votre espace, suivi de votre code client. Lorsque vous recevez le code de retrait, renseignez-le sur la commande : votre préparateur est notifié et récupère le colis.",
    },
    {
      q: "Combien d'articles puis-je stocker ?",
      a: `La capacité de stockage dépend de votre offre (${storage}). Au-delà, vous pouvez expédier des articles ou changer d'offre à tout moment.`,
    },
    {
      q: "Les frais de port sont-ils inclus ?",
      a: "Non. Les crédits couvrent la préparation ; l'affranchissement est distinct. Vous pouvez fournir votre propre étiquette (celle générée par une plateforme de vente, par exemple), ou les frais de transport vous sont indiqués séparément.",
    },
    {
      q: "Comment fonctionne la formule annuelle ?",
      a: "Vous payez l'année en une fois, à un prix réduit (deux mois offerts sur les tarifs actuels), et vous recevez vos crédits chaque mois comme en formule mensuelle : le premier mois au paiement, puis le même jour les mois suivants. Elle est renouvelée automatiquement chaque année, sauf si vous désactivez le renouvellement.",
    },
    {
      q: "Comment résilier ou changer d'offre ?",
      a: "Depuis votre espace (Facturation, puis Changer d'offre). Une offre supérieure ou le passage à l'annuel s'appliquent immédiatement, avec un nouveau paiement : votre offre précédente n'est plus renouvelée et ses crédits restent utilisables. Une offre inférieure prend effet à votre prochain renouvellement. Le retour au mensuel se fait à l'échéance de votre année. La résiliation prend effet à la fin de la période payée. Votre stock reste consultable et sa restitution est organisée avec le support.",
    },
    {
      q: "Mes messages sont-ils confidentiels ?",
      a: "Oui. La conversation avec votre préparateur est privée. L'équipe Packio ne peut y accéder que pour un besoin de support, avec un motif obligatoire, pour une durée limitée ; chaque accès est journalisé et signalé dans la conversation. Les échanges avec le support Packio se font dans une conversation distincte.",
    },
  ];
  return (
    <section id="faq" className="scroll-mt-20 border-y bg-muted/30 py-24 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeading align="left" eyebrow="FAQ" title="Questions fréquentes" description="Les règles exactes qui s'appliquent à votre compte figurent dans votre espace et dans nos conditions générales." />
        <Accordion type="single" collapsible className="rounded-2xl border bg-card px-5 shadow-soft sm:px-6">
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
