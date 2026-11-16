import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Ban, CalendarClock, Camera, ChevronDown, FileText, Layers, Lock, PlugZap, Ruler, Send, Store, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Synchronisation des ventes Vinted et Vestiaire",
  description:
    "Avec Packio Connect, vos ventes Vinted et Vestiaire Collective arrivent toutes seules dans Packio : article, taille, date limite, bordereau. Les annulations bloquent l'expédition et les colis déjà partis sont marqués expédiés.",
};

const ESSENTIALS = [
  { strong: "Chaque vente arrive seule", text: "avec le titre, la photo, la taille, la date limite d'envoi et le bordereau dès qu'il est généré." },
  { strong: "Une annulation bloque l'expédition", text: "tant que le colis n'est pas déposé ; l'article reste dans votre stock." },
  { strong: "Un colis parti est marqué expédié", text: "même si vous l'avez envoyé vous-même." },
  { strong: "Plusieurs comptes, un seul espace", text: "chaque colis indique de quel compte vient la vente." },
];

const FIELDS = [
  { icon: Camera, info: "Titre et photo", use: "Votre préparateur sait exactement quel article emballer." },
  { icon: Ruler, info: "Taille", use: "Aucune confusion entre deux articles qui se ressemblent." },
  { icon: CalendarClock, info: "Date limite d'envoi", use: "Les colis les plus urgents passent en tête de liste chez votre préparateur." },
  { icon: FileText, info: "Bordereau", use: "Joint automatiquement : votre préparateur n'a plus qu'à l'imprimer et le coller." },
  { icon: Store, info: "Compte d'origine", use: "Chaque colis rappelle le compte Vinted ou Vestiaire d'où vient la vente." },
];

const WATCHED = [
  {
    icon: Ban,
    title: "Les annulations",
    text: "Si la vente est annulée avant le dépôt, l'expédition est bloquée et l'article reste en stock. Pour un article commandé en dropshipping, vous choisissez de le garder en stock ou de le renvoyer au fournisseur.",
  },
  {
    icon: Send,
    title: "Les colis déjà partis",
    text: "Quand la plateforme indique un colis parti, il est marqué expédié dans Packio, y compris s'il a été déposé sans passer par votre préparateur.",
  },
  {
    icon: Layers,
    title: "Les ventes en lot",
    text: "Plusieurs articles achetés par la même personne partent dans un seul carton, avec un seul bordereau.",
  },
];

const FAQ = [
  {
    q: "Dois-je déclarer mes ventes moi-même ?",
    a: "Non : avec l'extension Packio Connect installée, vos ventes apparaissent seules dans « Toutes mes ventes ». Vous pouvez quand même en ajouter une à la main, par exemple pour une vente faite sur une autre plateforme.",
  },
  {
    q: "Et si j'ai plusieurs comptes Vinted ?",
    a: "Ils sont tous suivis dans le même espace Packio. Chaque vente et chaque colis indiquent le compte d'origine.",
  },
  {
    q: "Que se passe-t-il quand l'acheteur annule ?",
    a: "Packio repère l'annulation et bloque l'expédition si le colis n'est pas encore déposé. L'article reste dans votre stock ; s'il venait d'un fournisseur en dropshipping, vous choisissez de le garder ou de le renvoyer.",
  },
  {
    q: "Faut-il un code sur l'annonce pour que Packio retrouve l'article ?",
    a: "Non. Si un article de votre stock porte le même nom que l'annonce, il est pris automatiquement. Sinon, un clic sur « Vente normale » suffit : l'article le plus proche est déjà pré-sélectionné.",
  },
];

export default function SalesSyncPage() {
  return (
    <>
      <section className="relative overflow-hidden pt-16 pb-12 sm:pt-24">
        <div className="pointer-events-none absolute inset-x-0 -top-40 h-[28rem] bg-[radial-gradient(closest-side,var(--brand-soft),transparent)] opacity-80" aria-hidden />
        <Container className="relative max-w-4xl space-y-8">
          <nav aria-label="Fil d'Ariane" className="text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Packio
            </Link>{" "}
            <span aria-hidden>›</span> Synchronisation des ventes
          </nav>
          <div className="space-y-5">
            <p className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-brand uppercase">
              <PlugZap className="size-3.5" /> Packio Connect
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Vos ventes Vinted et Vestiaire arrivent <span className="text-brand">sans rien recopier</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Dès qu&apos;un article se vend, la vente apparaît dans Packio avec tout ce dont votre préparateur a besoin pour l&apos;expédier. Vous, vous continuez
              à vendre.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="h-11 px-6">
              <Link href="/inscription">
                Créer mon compte <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-6">
              <Link href="/#tarifs">Voir les tarifs</Link>
            </Button>
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-soft">
            <p className="text-xs font-semibold tracking-[0.16em] text-brand uppercase">En bref</p>
            <ul className="mt-4 space-y-3">
              {ESSENTIALS.map((e) => (
                <li key={e.strong} className="flex gap-3 leading-relaxed">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                  <span>
                    <span className="font-semibold">{e.strong}</span> <span className="text-muted-foreground">{e.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container className="max-w-4xl space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ce que Packio récupère pour chaque vente</h2>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
            <div className="hidden grid-cols-[14rem_1fr] border-b bg-muted/40 px-5 py-3 text-sm font-medium sm:grid">
              <span>Information</span>
              <span>À quoi elle sert</span>
            </div>
            <ul className="divide-y">
              {FIELDS.map((f) => (
                <li key={f.info} className="grid gap-1 px-5 py-4 sm:grid-cols-[14rem_1fr] sm:gap-4">
                  <span className="flex items-center gap-2 font-medium">
                    <f.icon className="size-4 text-brand" /> {f.info}
                  </span>
                  <span className="text-muted-foreground">{f.use}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container className="max-w-4xl space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ce que Packio suit ensuite</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {WATCHED.map((w) => (
              <div key={w.title} className="rounded-2xl border bg-card p-5 shadow-soft">
                <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <w.icon className="size-4" />
                </span>
                <p className="mt-3 font-semibold">{w.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{w.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container className="grid max-w-4xl gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Warehouse className="size-5 text-brand" /> Article déjà en stock ?
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              Si votre préparateur a déjà l&apos;article, la vente est prise sur votre stock : pas besoin de le recommander, il ne reste qu&apos;à emballer. Aucun
              code à recopier sur vos annonces.
            </p>
          </div>
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Lock className="size-5 text-brand" /> Vos comptes restent à vous
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              Packio Connect s&apos;installe dans votre propre navigateur Chrome. Votre mot de passe n&apos;est jamais demandé, et l&apos;extension ne publie ni ne
              modifie rien : elle lit vos ventes, c&apos;est tout.
            </p>
          </div>
          <p className="rounded-2xl border border-success/30 bg-success-soft/40 p-4 text-sm leading-relaxed md:col-span-2">
            <span className="font-semibold">Bon à savoir :</span> la synchronisation se fait toute seule, toutes les 15 minutes, tant que Chrome est ouvert et que
            vous êtes connecté à Vinted ou Vestiaire Collective sur cet ordinateur.
          </p>
        </Container>
      </section>

      <section className="py-12 pb-24">
        <Container className="max-w-4xl space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Questions fréquentes</h2>
          <div className="space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-2xl border bg-card px-5 py-4 shadow-soft">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}
                  <ChevronDown className="size-4 shrink-0 text-brand transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
