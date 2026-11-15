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
      q: "Chez quels fournisseurs puis-je commander ?",
      a: "Pour votre stock : ZenMarket, Vinted et Vestiaire Collective. En dropshipping (article déjà vendu, expédié à votre acheteur dès réception) : Temu, SHEIN et AliExpress. Tous les fournisseurs ne livrent pas vers tous les lockers ou points relais : Packio vérifie la compatibilité entre le fournisseur et le point de réception avant d'enregistrer votre commande, et vous propose l'adresse adaptée.",
    },
    {
      q: "Comment fonctionne la réception en locker ?",
      a: "Commandez en livraison vers le locker de votre préparateur en indiquant le nom de destinataire affiché dans votre espace, suivi de votre code client. Lorsque vous recevez le code de retrait, renseignez-le sur la commande : votre préparateur est notifié et récupère le colis.",
    },
    {
      q: "Combien d'articles puis-je stocker ?",
      a: `Le nombre de places dépend de votre offre (${storage}) : c'est le nombre d'articles stockés en même temps, commandes en cours d'acheminement comprises. Pour aller au-delà, ajoutez des places avec vos crédits (1 crédit = ${r.slotsPerCredit} places pendant ${durationLabel(r.extraSlotsDays)}), expédiez des articles ou passez à l'offre supérieure.`,
    },
    {
      q: "Combien de temps un article peut-il rester en stock ?",
      a:
        r.extensionCredits > 0
          ? `Chaque article dispose de ${durationLabel(r.includedDays)} de stockage incluses. Au-delà, ${extension} par article est prélevé automatiquement pour ${durationLabel(r.extensionDays)} de plus${r.reminderDaysBefore > 0 ? ` ; vous êtes prévenu ${durationLabel(r.reminderDaysBefore)} avant` : ""}. Si votre solde ne suffit pas, l'article passe « en dépassement » et la prolongation est prélevée dès que vous avez des crédits ; vous pouvez aussi l'expédier ou vous le faire renvoyer.`
          : `Chaque article dispose de ${durationLabel(r.includedDays)} de stockage incluses, prolongées par périodes de ${durationLabel(r.extensionDays)}.`,
    },
    {
      q: "Que se passe-t-il si une commande dépasse mes places ?",
      a: `Le formulaire de commande vous l'indique avant l'envoi, avec le nombre de crédits nécessaires pour les places manquantes (1 crédit = ${r.slotsPerCredit} places pendant ${durationLabel(r.extraSlotsDays)}). Ces crédits ne sont débités qu'avec votre accord ; si votre solde ne suffit pas, la commande est refusée. Les commandes en dropshipping n'occupent aucune place.`,
    },
    {
      q: "Les frais de port sont-ils inclus ?",
      a: "Non. Les crédits couvrent la préparation ; l'affranchissement est distinct. Vous pouvez fournir votre propre étiquette (celle générée par une plateforme de vente, par exemple), ou les frais de transport vous sont indiqués séparément.",
    },
    {
      q: `En combien de temps mes colis sont-ils expédiés ?`,
      a: `Votre préparateur s'engage à déposer chaque colis chez le transporteur dans les ${ctx.shippingHours} heures suivant votre demande. L'échéance s'affiche sur l'expédition ; si elle est dépassée, votre préparateur et l'équipe Packio sont alertés. Le délai est suspendu tant qu'une expédition attend des crédits, et repart dès qu'ils sont réservés. Les délais de livraison du transporteur s'ajoutent ensuite.`,
    },
    {
      q: "Puis-je me faire renvoyer un article ?",
      a: "Oui. Depuis la fiche de l'article ou la demande d'expédition, choisissez le retour à votre adresse : votre préparateur prépare le colis comme une expédition classique, avec les mêmes crédits de préparation. Les frais de transport restent à votre charge, avec votre propre étiquette ou celle indiquée par votre préparateur.",
    },
    {
      q: "Comment fonctionne le dropshipping Vinted ?",
      a: `Vous avez vendu un article que vous n'avez pas encore ? Commandez-le sur Temu, SHEIN ou AliExpress en livraison vers votre préparateur et déclarez la commande en dropshipping, avec le bordereau de la vente (ou l'adresse de l'acheteur). À la réception, votre préparateur l'expédie directement à l'acheteur, sous ${ctx.shippingHours} h : l'article n'occupe aucune place de stock. Vous restez l'interlocuteur de votre acheteur et respectez les règles de la plateforme de vente.`,
    },
    {
      q: "Puis-je récupérer les photos de mes articles ?",
      a: "Oui. Votre préparateur photographie vos articles en stock ; vous êtes prévenu dès que les photos sont disponibles et vous les téléchargez depuis la fiche de l'article, pour créer vos annonces vous-même.",
    },
    {
      q: "Qu'est-ce que Packio Connect ?",
      a: "Une extension de navigateur, en version bêta, que vous installez sur votre ordinateur. Elle relie vos comptes Vinted et Vestiaire Collective à Packio : elle repère quel article s'est vendu et quand, puis récupère le bordereau d'expédition et le joint à l'article, pour que votre préparateur n'ait plus qu'à l'imprimer. Elle utilise vos sessions déjà ouvertes dans votre navigateur, ne lit que les données utiles à vos ventes et ne connaît jamais vos mots de passe. Vous pouvez la déconnecter à tout moment depuis votre espace. Les plateformes ne proposent pas d'accès officiel : leur fonctionnement peut évoluer, et vous restez responsable du respect de leurs conditions d'utilisation.",
    },
    {
      q: "Comment fonctionne la formule annuelle ?",
      a: `Vous payez l'année en une fois, à un prix réduit${ctx.annualBadge ? ` (${ctx.annualBadge} sur les tarifs actuels)` : ""}, et vous recevez vos crédits chaque mois comme en formule mensuelle : le premier mois au paiement, puis le même jour les mois suivants. Elle vous engage pour 12 mois et se renouvelle automatiquement chaque année, sauf si vous désactivez le renouvellement.`,
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
