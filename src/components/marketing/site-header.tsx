import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { getActor, homePathFor } from "@/server/auth/current";
import { MARKETING_LINKS } from "./nav-links";
import { MobileMenu } from "./mobile-menu";

export async function SiteHeader() {
  const actor = await getActor().catch(() => null);
  const account = actor ? { href: homePathFor(actor), label: "Mon espace" } : null;
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Accueil Packio" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex" aria-label="Navigation principale">
          {MARKETING_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden h-9 px-3 sm:inline-flex">
            <Link href={account?.href ?? "/connexion"}>{account?.label ?? "Connexion"}</Link>
          </Button>
          <Button asChild className="hidden h-9 px-3.5 sm:inline-flex">
            <Link href="/#tarifs">
              Choisir une offre <ArrowRight />
            </Link>
          </Button>
          <MobileMenu account={account} />
        </div>
      </div>
    </header>
  );
}
