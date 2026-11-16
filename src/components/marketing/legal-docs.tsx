import Link from "next/link";
import type { Settings } from "@/server/services/settings";

/**
 * Modèles de documents légaux générés à partir des paramètres de la
 * plateforme (Back-office → Paramètres → Légal). Toute valeur manquante est
 * signalée par un marqueur « [À compléter] ».
 */

export type LegalContext = {
  legal: Settings["legal"];
  support: Settings["support"];
  credits: Settings["credits"];
  slaHours: number;
  supervisionMinutes: number;
  appUrl: string;
  sizes: { label: string; creditCost: number }[];
  storage: Settings["storage"];
  /** Délai d'expédition promis (heures). */
  shippingHours: number;
  /** Coût fixe d'un retour à domicile (crédits). */
  returnCredits: number;
};

/** Durée lisible : 14 → « 2 semaines », 30 → « 30 jours ». */
function days(n: number) {
  if (n % 7 === 0) return `${n / 7} semaine${n / 7 > 1 ? "s" : ""}`;
  return `${n} jour${n > 1 ? "s" : ""}`;
}

function creditsLabel(n: number) {
  return `${n} crédit${n > 1 ? "s" : ""}`;
}

export function Fill({ value, label }: { value?: string | null; label?: string }) {
  if (value && value.trim()) return <>{value}</>;
  return (
    <mark className="rounded bg-warning-soft px-1 font-medium text-warning" title={label}>
      [À compléter{label ? ` : ${label}` : ""}]
    </mark>
  );
}

function Company({ ctx }: { ctx: LegalContext }) {
  return <Fill value={ctx.legal.companyName} label="raison sociale" />;
}

function ContactEmail({ ctx }: { ctx: LegalContext }) {
  const email = ctx.legal.contactEmail || ctx.support.email;
  return email ? <a href={`mailto:${email}`}>{email}</a> : <Fill label="e-mail de contact" />;
}

export function MentionsLegales({ ctx }: { ctx: LegalContext }) {
  const l = ctx.legal;
  return (
    <>
      <h2>Éditeur du site</h2>
      <ul>
        <li>
          Raison sociale : <Company ctx={ctx} />
        </li>
        <li>
          Forme juridique : <Fill value={l.legalForm} label="forme juridique" /> — capital social : <Fill value={l.capital} label="capital" />
        </li>
        <li>
          Siège social : <Fill value={l.address} label="adresse du siège" />
        </li>
        <li>
          SIRET : <Fill value={l.siret} label="SIRET" /> — RCS : <Fill value={l.rcs} label="RCS" />
        </li>
        <li>
          N° de TVA intracommunautaire : <Fill value={l.vatNumber} label="TVA" />
        </li>
        <li>
          Directeur de la publication : <Fill value={l.publicationDirector} label="directeur de la publication" />
        </li>
        <li>
          Contact : <ContactEmail ctx={ctx} />
          {ctx.support.phone ? ` — ${ctx.support.phone}` : ""}
        </li>
      </ul>
      <h2>Hébergement</h2>
      <p>
        Le site et l&apos;application sont hébergés par <Fill value={l.hostName} label="hébergeur" />, <Fill value={l.hostAddress} label="adresse de l'hébergeur" />.
      </p>
      <h2>Propriété intellectuelle</h2>
      <p>
        La marque Packio, son logo, l&apos;interface, les textes et le code de la plateforme sont protégés. Toute reproduction ou représentation, totale ou partielle, sans
        autorisation écrite préalable de <Company ctx={ctx} /> est interdite.
      </p>
      <h2>Données personnelles</h2>
      <p>
        Le traitement de vos données personnelles est décrit dans la <Link href="/legal/confidentialite">politique de confidentialité</Link>. L&apos;usage des cookies est
        détaillé dans la <Link href="/legal/cookies">politique relative aux cookies</Link>.
      </p>
      <h2>Signalement</h2>
      <p>
        Pour signaler un contenu ou un comportement contraire à la loi, écrivez à <ContactEmail ctx={ctx} />.
      </p>
    </>
  );
}

export function Cgu({ ctx }: { ctx: LegalContext }) {
  return (
    <>
      <h2>1. Objet</h2>
      <p>
        Les présentes conditions générales d&apos;utilisation (CGU) encadrent l&apos;accès et l&apos;utilisation de la plateforme Packio, éditée par <Company ctx={ctx} />,
        accessible à l&apos;adresse {ctx.appUrl}. Packio met en relation des vendeurs (les « Clients ») avec des préparateurs de commandes indépendants ou salariés
        (les « Préparateurs ») chargés de réceptionner, stocker, préparer et expédier les articles des Clients. Packio fournit la plateforme et ne manipule pas les
        colis : la réception, la préparation et l&apos;envoi sont assurés par le Préparateur.
      </p>
      <h2>2. Comptes et rôles</h2>
      <ul>
        <li>
          <strong>Client</strong> : crée son compte librement, souscrit un abonnement et gère ses commandes, son stock, ses expéditions, ses crédits et sa messagerie.
        </li>
        <li>
          <strong>Préparateur</strong> : compte créé sur invitation de Packio ; il reçoit, prépare et envoie les colis des Clients qui lui sont attribués et
          n&apos;accède qu&apos;à leurs opérations. Il renseigne à son inscription son téléphone, son adresse de réception et, s&apos;il le souhaite, des lockers
          (Mondial Relay, Vinted Go, Chronopost), communiqués aux Clients après validation par Packio.
        </li>
        <li>
          <strong>Administration Packio</strong> : gère la plateforme selon des permissions définies, chaque action sensible étant journalisée.
        </li>
      </ul>
      <p>
        L&apos;utilisateur s&apos;engage à fournir des informations exactes, à garder ses identifiants confidentiels et à signaler sans délai toute utilisation non
        autorisée. Les tentatives de connexion répétées sont temporairement bloquées par mesure de sécurité.
      </p>
      <h2>3. Attribution du préparateur</h2>
      <p>
        Après activation de l&apos;abonnement, un préparateur personnel est attribué au Client par l&apos;équipe Packio, manuellement, dans un délai cible de{" "}
        {ctx.slaHours} heures. Aucune attribution n&apos;est réalisée automatiquement. En cas de retard, le Client en est informé. Packio peut procéder à une
        réattribution (indisponibilité, capacité, qualité de service) ; l&apos;historique des commandes est conservé et un éventuel transfert de stock est organisé de
        manière contrôlée.
      </p>
      <h2>4. Commandes et points de réception</h2>
      <p>
        Le Client déclare ses achats dans son espace et les fait livrer exclusivement aux points de réception validés de son préparateur, en reprenant le nom de
        destinataire et le code client indiqués. Packio vérifie la compatibilité déclarée entre fournisseur et type de point de réception, mais les options de
        livraison proposées restent sous la responsabilité de chaque fournisseur. Pour les lockers, le Client transmet le code de retrait reçu. Une commande peut
        être déclarée en dropshipping lorsque l&apos;article est déjà vendu : il est alors expédié à l&apos;acheteur dès sa réception, sans entrer dans le stock.
      </p>
      <h2>5. Stock</h2>
      <p>
        Les articles réceptionnés sont contrôlés, photographiés si possible et enregistrés dans le stock du Client avec une référence interne et un emplacement. Les
        photos réalisées par le Préparateur sont mises à la disposition du Client, qui peut les télécharger pour ses propres annonces. Tout mouvement (réception,
        réservation, expédition, perte, casse, inventaire) est historisé et ne peut être effacé. Le nombre de places et la durée de stockage dépendent de
        l&apos;offre souscrite et des conditions générales de vente. Sont interdits : produits illicites, dangereux, contrefaits, périssables, animaux, armes,
        substances réglementées, et tout article dont le transport est restreint.
      </p>
      <h2>6. Expéditions, classification et crédits</h2>
      <p>
        Le Client demande l&apos;expédition d&apos;articles en stock, à un acheteur ou à sa propre adresse (retour à domicile, au forfait prévu par les conditions
        générales de vente). Seul le Préparateur détermine la catégorie réelle du colis ({ctx.sizes.map((s) => s.label.toLowerCase()).join(", ")}), selon les règles fixées par Packio. Le coût en crédits correspondant est réservé
        à la classification puis définitivement débité au dépôt du colis chez le transporteur. Toute classification peut être contestée depuis la fiche de
        l&apos;expédition. Le Préparateur s&apos;engage à déposer le colis dans les {ctx.shippingHours} heures suivant la demande, dans les conditions prévues par les
        conditions générales de vente. Les frais de transport sont distincts des crédits de préparation.
      </p>
      <h2>7. Comptes de vente liés (Packio Connect)</h2>
      <p>
        Le Client peut installer l&apos;extension de navigateur Packio Connect et la relier à son espace au moyen d&apos;un jeton personnel, révocable à tout moment.
        L&apos;extension utilise les sessions déjà ouvertes par le Client sur ses propres comptes Vinted et Vestiaire Collective pour transmettre à Packio ses
        annonces, ses ventes et les bordereaux d&apos;expédition correspondants. Elle ne transmet ni identifiant ni mot de passe. Ces plateformes ne proposent pas
        d&apos;accès officiel : le service est fourni en version bêta, sans garantie de continuité, et le Client reste seul responsable du respect des conditions
        d&apos;utilisation des plateformes sur lesquelles il vend. Il ne doit relier que des comptes dont il est titulaire.
      </p>
      <h2>8. Messagerie</h2>
      <p>
        Une conversation privée est ouverte entre le Client et son Préparateur. L&apos;équipe Packio n&apos;y accède que pour un besoin de support, avec un motif
        obligatoire, pour une durée limitée ({ctx.supervisionMinutes} minutes par accès) ; chaque accès est journalisé et signalé aux participants par un message
        visible dans la conversation. Les échanges doivent rester courtois et liés au service ; tout contenu illicite ou abusif peut entraîner la suspension du compte.
      </p>
      <h2>9. Incidents</h2>
      <p>
        Colis abîmé, manquant, non conforme ou problème de transport : l&apos;incident est déclaré depuis la plateforme, avec photos si possible, et suivi jusqu&apos;à
        sa résolution par l&apos;équipe Packio.
      </p>
      <h2>10. Suspension et clôture</h2>
      <p>
        Packio peut suspendre un compte en cas de manquement grave aux présentes CGU, d&apos;impayé ou de risque pour la sécurité, après information de
        l&apos;utilisateur sauf urgence. L&apos;utilisateur peut demander la clôture de son compte au support ; ses données sont alors anonymisées dans les conditions
        prévues par la politique de confidentialité, après restitution du stock éventuel.
      </p>
      <h2>11. Évolution et droit applicable</h2>
      <p>
        Les CGU peuvent évoluer ; la version en vigueur est celle publiée sur le site. Elles sont soumises au droit français. Contact : <ContactEmail ctx={ctx} />.
      </p>
    </>
  );
}

export function Cgv({ ctx }: { ctx: LegalContext }) {
  const monthly =
    ctx.credits.monthly.mode === "EXPIRE"
      ? "Les crédits mensuels non utilisés expirent au renouvellement suivant."
      : `Les crédits mensuels non utilisés sont reportés pendant ${ctx.credits.monthly.rolloverMonths} mois, dans la limite de ${ctx.credits.monthly.rolloverCapPercent} % de l'allocation mensuelle de l'offre.`;
  const purchased =
    ctx.credits.purchased.mode === "NEVER"
      ? "Les crédits achetés en recharge n'expirent pas tant que le compte est actif."
      : `Les crédits achetés en recharge sont valables ${ctx.credits.purchased.days} jours à compter de leur achat.`;
  return (
    <>
      <h2>1. Champ d&apos;application</h2>
      <p>
        Les présentes conditions générales de vente (CGV) s&apos;appliquent aux abonnements et recharges de crédits souscrits sur Packio auprès de <Company ctx={ctx} />.
        Le service s&apos;adresse principalement à des vendeurs professionnels ou semi-professionnels.
      </p>
      <h2>2. Offres et prix</h2>
      <p>
        Les offres (abonnements incluant un nombre mensuel de crédits de préparation) et les recharges ponctuelles sont présentées sur la page Tarifs, avec leurs prix
        TTC en vigueur au jour de la souscription. Chaque offre est proposée en formule mensuelle et, lorsque la page Tarifs l&apos;indique, en formule annuelle à
        prix réduit. Chaque offre inclut un préparateur attitré, le tableau de bord, le suivi du stock et la messagerie. Packio peut faire
        évoluer ses tarifs ; les nouveaux prix s&apos;appliquent aux nouvelles souscriptions, et aux abonnements en cours après information préalable du Client.
      </p>
      <h2>3. Paiement</h2>
      <p>
        Le paiement est réalisé par carte bancaire (ou tout moyen proposé) via Whop, plateforme de paiement sécurisée. Packio ne stocke aucune donnée de carte.
        La formule mensuelle est prélevée tous les 30 jours ; la formule annuelle est payée en une fois pour 12 mois. Les deux sont renouvelées automatiquement à
        leur échéance. Des codes promotionnels peuvent être appliqués lors du paiement, selon leurs conditions
        propres. Les factures sont disponibles dans l&apos;espace Facturation.
      </p>
      <h2>4. Échec de paiement</h2>
      <p>
        En cas d&apos;échec de paiement, le Client est notifié et invité à mettre à jour son moyen de paiement. Tant que la situation n&apos;est pas régularisée, les nouvelles
        commandes et expéditions peuvent être suspendues ; le stock reste conservé.
      </p>
      <h2>5. Crédits</h2>
      <ul>
        <li>
          Un crédit rémunère la réception, le stockage et la préparation des colis, ainsi que les prolongations de stockage et les places supplémentaires (article 6) ;
          il n&apos;a pas de valeur monétaire et n&apos;est ni cessible ni remboursable.
        </li>
        <li>
          Coût par colis selon la catégorie déterminée par le préparateur : {ctx.sizes.map((s) => `${s.label.toLowerCase()} ${s.creditCost} crédit${s.creditCost > 1 ? "s" : ""}`).join(", ")}.
        </li>
        <li>
          Les crédits de l&apos;abonnement sont versés chaque mois, y compris en formule annuelle : le premier mois au paiement, puis le même jour les mois suivants,
          soit 12 versements par an.
        </li>
        <li>Les crédits sont réservés à la classification, débités au dépôt du colis, et libérés en cas d&apos;annulation avant le début de la préparation.</li>
        <li>
          {monthly} {purchased}
        </li>
        <li>Si le solde est insuffisant, l&apos;expédition reste en attente et reprend automatiquement après recharge.</li>
        <li>
          Le Préparateur peut retirer des crédits pour une prestation particulière (par exemple un emballage spécial) : le motif est obligatoirement communiqué au
          Client dans la messagerie et figure dans son historique de crédits. Le Client peut contester un retrait auprès du support Packio.
        </li>
      </ul>
      <h2>6. Stockage</h2>
      <ul>
        <li>
          Chaque offre inclut un nombre de places, c&apos;est-à-dire d&apos;articles stockés en même temps chez le Préparateur, indiqué sur la page Tarifs. Sont pris en
          compte les articles en stock et ceux des commandes en cours d&apos;acheminement vers le Préparateur.
        </li>
        <li>
          Des places supplémentaires peuvent être ajoutées avec des crédits : 1 crédit donne droit à {ctx.storage.slotsPerCredit} places pendant{" "}
          {days(ctx.storage.extraSlotsDays)} à compter de leur ajout.
        </li>
        <li>
          Lorsqu&apos;une commande déclarée dépasse les places disponibles, le nombre de crédits nécessaires pour les places manquantes est indiqué au Client avant
          l&apos;enregistrement ; ils ne sont débités qu&apos;avec son accord exprès. À défaut d&apos;accord ou de solde suffisant, la commande n&apos;est pas enregistrée.
        </li>
        <li>
          Chaque article bénéficie de {days(ctx.storage.includedDays)} de stockage incluses à compter de sa mise en stock.
          {ctx.storage.extensionCredits > 0 ? (
            <>
              {" "}
              Au-delà, la durée est prolongée par périodes de {days(ctx.storage.extensionDays)}, au prix de {creditsLabel(ctx.storage.extensionCredits)} par article
              et par période, prélevé automatiquement à l&apos;échéance.
              {ctx.storage.reminderDaysBefore > 0 ? ` Le Client en est informé ${days(ctx.storage.reminderDaysBefore)} avant.` : ""}
            </>
          ) : (
            <> Au-delà, la durée est prolongée par périodes de {days(ctx.storage.extensionDays)}, sans frais.</>
          )}
        </li>
        <li>
          Si le solde de crédits est insuffisant à l&apos;échéance, l&apos;article est signalé « en dépassement » et la prolongation est prélevée dès que des crédits
          sont disponibles. Le Client peut à tout moment faire expédier l&apos;article ou demander son retour à domicile. Un dépassement prolongé et non régularisé
          peut conduire Packio à organiser la restitution de l&apos;article aux frais du Client, après relance restée sans effet.
        </li>
        <li>Les articles commandés en dropshipping (article 8) n&apos;occupent aucune place et ne sont pas soumis à la durée de stockage.</li>
      </ul>
      <h2>7. Expéditions, délai et retours</h2>
      <p>
        Le Préparateur s&apos;engage à déposer chaque colis chez le transporteur dans les {ctx.shippingHours} heures suivant la demande d&apos;expédition. Ce délai est
        suspendu tant que l&apos;expédition est en attente de crédits (il repart à la réservation des crédits), ainsi qu&apos;en cas d&apos;incident sur le colis, de
        demande d&apos;information au Client, de fermeture du transporteur ou de force majeure. Il s&apos;agit d&apos;un engagement de moyens : son dépassement est signalé
        au Préparateur et à Packio, qui interviennent, mais n&apos;ouvre pas droit à indemnisation automatique. Les délais d&apos;acheminement du transporteur
        s&apos;ajoutent à ce délai.
      </p>
      <p>
        Le Client peut demander le retour d&apos;articles à sa propre adresse. Le retour coûte {creditsLabel(ctx.returnCredits)} par demande, quels que soient le
        nombre d&apos;articles et la taille du colis : {ctx.returnCredits > 1 ? "ils sont réservés" : "il est réservé"} à la demande et débité{ctx.returnCredits > 1 ? "s" : ""}{" "}
        au dépôt du colis. Les frais de transport sont à la charge du Client, qui joint à sa demande un bordereau prépayé ; le Préparateur l&apos;imprime et dépose le
        colis.
      </p>
      <h2>8. Dropshipping</h2>
      <p>
        Lorsqu&apos;un article est déjà vendu, le Client peut le commander auprès de son fournisseur en livraison vers le Préparateur et déclarer la commande en
        dropshipping, avec le bordereau d&apos;expédition de la vente ou l&apos;adresse de l&apos;acheteur. À la réception, le Préparateur contrôle l&apos;article et
        l&apos;expédie à l&apos;acheteur dans le délai prévu à l&apos;article 7. Un article en dropshipping n&apos;occupe aucune place de stock, mais les crédits de
        préparation s&apos;appliquent selon la taille du colis. Le Client reste
        le vendeur : il est seul responsable de la relation avec son acheteur (description, délais annoncés, retours, litiges), de l&apos;exactitude du bordereau
        et des informations transmises, ainsi que du respect des règles de la plateforme de vente.
      </p>
      <h2>9. Packio Connect</h2>
      <p>
        L&apos;extension Packio Connect, proposée en version bêta et sans supplément, transmet à Packio, à la demande du Client et avec son consentement, les annonces,
        ventes et bordereaux issus de ses propres comptes Vinted et Vestiaire Collective, afin de créer automatiquement les expéditions correspondantes. Elle ne
        transmet aucun identifiant ni mot de passe et peut être déconnectée à tout moment depuis l&apos;espace client. Son fonctionnement dépend de services tiers
        susceptibles d&apos;évoluer sans préavis : Packio ne garantit pas sa disponibilité continue. Le Client vérifie les expéditions créées et reste responsable du
        respect des conditions d&apos;utilisation des plateformes concernées.
      </p>
      <h2>10. Frais de transport</h2>
      <p>
        Les frais d&apos;affranchissement ne sont pas inclus dans les crédits. Le Client fournit son étiquette d&apos;expédition, ou les frais de transport lui sont indiqués et
        facturés séparément.
      </p>
      <h2>11. Changement d&apos;offre et résiliation</h2>
      <p>
        Aucun changement n&apos;est facturé au prorata. Le passage à une offre moins chère, dans la même formule, prend effet au renouvellement suivant, avec le
        nouveau prix et les crédits de la nouvelle offre. Le passage à une offre plus chère, ou de la formule mensuelle à la formule annuelle, est immédiat : la
        nouvelle offre est payée et ses crédits versés le jour même ; l&apos;offre précédente n&apos;est plus renouvelée, ses crédits déjà versés restent utilisables
        et, pour une formule annuelle, les crédits mensuels restant dus sur la période payée continuent d&apos;être versés jusqu&apos;à son échéance. Le passage de la
        formule annuelle à la formule mensuelle prend effet à l&apos;échéance annuelle : le Client active alors la formule mensuelle. Des crédits supplémentaires
        (10, 30, 50 ou 100) peuvent être achetés à tout moment.
      </p>
      <p>
        La formule mensuelle est sans engagement. La formule annuelle engage le Client pour la période de 12 mois payée. Dans les deux cas, la résiliation (arrêt du
        renouvellement automatique) prend effet à la fin de la période payée, sans remboursement de la période en cours ni des crédits consommés, ni des
        prolongations de stockage et places supplémentaires déjà utilisées. Le stock est alors restitué au Client selon des modalités convenues avec le support
        (frais de transport à sa charge).
      </p>
      <h2>12. Droit de rétractation</h2>
      <p>
        Pour les Clients consommateurs, le droit de rétractation de 14 jours s&apos;applique ; en demandant l&apos;exécution du service avant la fin de ce délai, le Client
        reconnaît que les prestations déjà exécutées (crédits consommés) restent dues. Les Clients professionnels ne bénéficient pas de ce droit.
      </p>
      <h2>13. Responsabilité</h2>
      <p>
        Packio fournit la plateforme qui met en relation le Client et son Préparateur ; la réception, la préparation, l&apos;emballage et l&apos;envoi des colis sont
        assurés par le Préparateur. Packio s&apos;engage à mettre en œuvre les moyens nécessaires à la bonne exécution du service.
      </p>
      <p>
        <strong>Packio n&apos;est pas responsable de la perte, du vol ou de l&apos;avarie d&apos;un colis</strong>, notamment pendant son acheminement par un
        fournisseur ou un transporteur. Les réclamations relatives au transport sont adressées au transporteur ou, pour un bordereau généré par une plateforme de
        vente (Vinted, Vestiaire Collective…), à cette plateforme, selon ses conditions. Les incidents survenus pendant la garde du Préparateur sont signalés via la
        plateforme et traités entre le Client et le Préparateur, Packio facilitant leur résolution à partir des photos et de l&apos;historique des mouvements. Packio
        n&apos;est pas non plus responsable du contenu des articles achetés par le Client.
      </p>
      <p>
        En tout état de cause, et dans les limites permises par la loi, la responsabilité de Packio est limitée au montant payé par le Client au cours des trois
        derniers mois, sauf faute lourde ou dolosive.
      </p>
      <h2>14. Réclamations et médiation</h2>
      <p>
        Toute réclamation peut être adressée à <ContactEmail ctx={ctx} />. Le Client consommateur peut recourir gratuitement au médiateur de la consommation :{" "}
        {ctx.legal.consumerMediator ? ctx.legal.consumerMediator : <Fill label="nom et coordonnées du médiateur" />}.
      </p>
    </>
  );
}

export function Confidentialite({ ctx }: { ctx: LegalContext }) {
  const dpo = ctx.legal.dpoEmail || ctx.legal.contactEmail || ctx.support.email;
  return (
    <>
      <h2>1. Responsable de traitement</h2>
      <p>
        <Company ctx={ctx} />, <Fill value={ctx.legal.address} label="adresse" />. Contact pour vos données personnelles :{" "}
        {dpo ? <a href={`mailto:${dpo}`}>{dpo}</a> : <Fill label="e-mail DPO / contact RGPD" />}.
      </p>
      <h2>2. Données traitées</h2>
      <ul>
        <li>Identité et contact : nom, prénom, adresse e-mail, téléphone, société.</li>
        <li>Compte : identifiants (mot de passe chiffré par hachage), journaux de connexion, préférences de notification.</li>
        <li>
          Logistique : commandes déclarées (y compris en dropshipping, avec l&apos;adresse de l&apos;acheteur lorsqu&apos;elle est fournie), numéros de suivi, codes de
          retrait, articles en stock, photos, adresses des destinataires des expéditions et adresse de retour du Client.
        </li>
        <li>
          Comptes de vente liés (extension Packio Connect, si vous l&apos;installez) : identifiant et pseudonyme de vos comptes Vinted et Vestiaire Collective,
          annonces (titre, prix, lien, photo principale), ventes (date, article, prix, nom ou pseudonyme de l&apos;acheteur) et bordereaux d&apos;expédition. Aucun
          mot de passe ni identifiant de connexion n&apos;est collecté.
        </li>
        <li>Facturation : abonnement, paiements, factures (les données de carte sont traitées exclusivement par Whop et ses prestataires de paiement).</li>
        <li>Communications : messages échangés, pièces jointes, demandes de support et de contact, incidents.</li>
        <li>Préparateurs : informations professionnelles, adresses de réception, disponibilités, capacité.</li>
      </ul>
      <h2>3. Finalités et bases légales</h2>
      <ul>
        <li>Fourniture du service (compte, attribution, commandes, stock, expéditions, messagerie) — exécution du contrat.</li>
        <li>
          Détection de vos ventes et préparation automatique des expéditions avec leur bordereau (Packio Connect) — exécution du contrat, à votre demande ;
          vous pouvez déconnecter l&apos;extension et révoquer son jeton à tout moment.
        </li>
        <li>Facturation, comptabilité, prévention de la fraude — obligation légale et intérêt légitime.</li>
        <li>Sécurité (journal d&apos;audit, limitation des tentatives de connexion) — intérêt légitime.</li>
        <li>Notifications de service par e-mail et dans l&apos;application — exécution du contrat (préférences modifiables).</li>
        <li>Réponse aux demandes de contact — intérêt légitime / mesures précontractuelles.</li>
      </ul>
      <p>
        Les données lues par l&apos;extension Packio Connect servent uniquement à cette fonction : elles ne sont ni vendues, ni utilisées à des fins publicitaires,
        de profilage ou d&apos;évaluation de solvabilité, ni transmises à d&apos;autres destinataires que ceux listés ci-dessous. Elles ne sont consultées par une
        personne de l&apos;équipe Packio qu&apos;avec votre accord, pour un besoin de sécurité ou en cas d&apos;obligation légale. Cet usage respecte le règlement du
        Chrome Web Store relatif aux données des utilisateurs, y compris ses exigences d&apos;utilisation limitée.
      </p>
      <h2>4. Destinataires et sous-traitants</h2>
      <ul>
        <li>
          Votre préparateur attitré, uniquement pour les données nécessaires à l&apos;exécution du service (dont les bordereaux et adresses des expéditions qui lui
          sont confiées).
        </li>
        <li>L&apos;équipe Packio habilitée, selon des permissions par rôle.</li>
        <li>Whop — traitement des paiements, des abonnements et des reçus.</li>
        <li>
          <Fill value={ctx.legal.hostName} label="hébergeur" /> — hébergement de l&apos;application et de la base de données.
        </li>
        <li>Resend — envoi des e-mails transactionnels.</li>
        <li>L&apos;hébergeur ci-dessus ou un prestataire de stockage compatible S3 — conservation privée des photos et documents.</li>
        <li>Transporteurs — données du destinataire figurant sur l&apos;étiquette d&apos;expédition.</li>
      </ul>
      <p>Lorsque des données sont transférées hors de l&apos;Union européenne, ces transferts sont encadrés par des garanties appropriées (clauses contractuelles types).</p>
      <h2>5. Confidentialité des conversations</h2>
      <p>
        La conversation entre un Client et son Préparateur est privée. Un membre habilité de l&apos;équipe Packio ne peut y accéder que pour un besoin de support, en
        indiquant un motif obligatoire, pour une durée limitée à {ctx.supervisionMinutes} minutes, en lecture seule. Chaque accès est enregistré dans le journal
        d&apos;audit et signalé aux participants par un message visible dans la conversation. Lors d&apos;une réattribution, l&apos;ancien préparateur perd l&apos;accès à la
        conversation.
      </p>
      <h2>6. Durées de conservation</h2>
      <ul>
        <li>Données de compte et logistiques : durée de la relation contractuelle, puis 3 ans à des fins de preuve, sauf obligation légale contraire.</li>
        <li>
          Données des comptes de vente liés : tant que l&apos;extension est reliée et au plus pendant la relation contractuelle ; les ventes ayant donné lieu à une
          expédition sont conservées comme les données logistiques.
        </li>
        <li>Factures et pièces comptables : 10 ans.</li>
        <li>Journal d&apos;audit et registres de crédits et de stock : durée nécessaire à la preuve des opérations, au plus 5 ans après la clôture du compte.</li>
        <li>Demandes de contact sans suite : 3 ans.</li>
        <li>Tentatives de connexion : 30 jours.</li>
      </ul>
      <p>À la clôture d&apos;un compte, les données d&apos;identification sont anonymisées ; les registres comptables et d&apos;audit sont conservés sans données directement identifiantes lorsque c&apos;est possible.</p>
      <h2>7. Sécurité</h2>
      <p>
        Mots de passe hachés, sessions sécurisées (cookie httpOnly), contrôle d&apos;accès côté serveur sur chaque action, fichiers stockés de manière privée et servis
        uniquement aux personnes autorisées, journalisation des actions sensibles.
      </p>
      <h2>8. Vos droits</h2>
      <p>
        Vous disposez des droits d&apos;accès, de rectification, d&apos;effacement, de limitation, d&apos;opposition et de portabilité de vos données, ainsi que du droit de
        définir des directives post-mortem. Pour les exercer : {dpo ? <a href={`mailto:${dpo}`}>{dpo}</a> : <Fill label="e-mail DPO" />}. Vous pouvez introduire une
        réclamation auprès de la CNIL (www.cnil.fr).
      </p>
    </>
  );
}

export function Cookies({ ctx }: { ctx: LegalContext }) {
  return (
    <>
      <h2>Ce que nous utilisons</h2>
      <p>Packio n&apos;utilise que des traceurs strictement nécessaires au fonctionnement du service. Ils sont exemptés de consentement.</p>
      <div className="not-prose overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Nom</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Finalité</th>
              <th className="px-4 py-2.5 font-medium">Durée</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="px-4 py-2.5 font-mono text-xs">packio_session</td>
              <td className="px-4 py-2.5">Cookie (httpOnly, sécurisé)</td>
              <td className="px-4 py-2.5">Maintenir votre connexion à votre espace</td>
              <td className="px-4 py-2.5">30 jours</td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-mono text-xs">theme</td>
              <td className="px-4 py-2.5">Stockage local du navigateur</td>
              <td className="px-4 py-2.5">Mémoriser le thème clair / sombre choisi</td>
              <td className="px-4 py-2.5">Jusqu&apos;à suppression</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2>Ce que nous n&apos;utilisons pas</h2>
      <p>
        Aucun cookie publicitaire, de mesure d&apos;audience ou de réseau social n&apos;est déposé. C&apos;est pourquoi aucun bandeau de consentement ne vous est présenté. Si
        Packio venait à en utiliser, votre consentement préalable serait recueilli.
      </p>
      <h2>Paiement</h2>
      <p>
        Lors du paiement, vous êtes redirigé vers la page de paiement sécurisée de Whop, qui peut déposer ses propres cookies nécessaires à la sécurité des transactions et à la
        prévention de la fraude, selon sa propre politique.
      </p>
      <h2>Gérer les cookies</h2>
      <p>
        Vous pouvez supprimer ces données à tout moment depuis les réglages de votre navigateur ; la suppression du cookie de session vous déconnecte. Questions :{" "}
        <ContactEmail ctx={ctx} />.
      </p>
    </>
  );
}

export const LEGAL_DOCS = {
  "mentions-legales": { title: "Mentions légales", description: "Informations sur l'éditeur et l'hébergeur de Packio.", Component: MentionsLegales },
  cgu: { title: "Conditions générales d'utilisation", description: "Règles d'utilisation de la plateforme Packio.", Component: Cgu },
  cgv: { title: "Conditions générales de vente", description: "Abonnements, crédits, stockage, expéditions, paiement et résiliation.", Component: Cgv },
  confidentialite: { title: "Politique de confidentialité", description: "Comment Packio traite et protège vos données personnelles.", Component: Confidentialite },
  cookies: { title: "Politique relative aux cookies", description: "Les traceurs utilisés par Packio.", Component: Cookies },
} as const;

export type LegalSlug = keyof typeof LEGAL_DOCS;
