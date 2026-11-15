"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { MARKETING_LINKS } from "./nav-links";

export function MobileMenu({ account }: { account: { href: string; label: string } | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Ouvrir le menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(88vw,20rem)] p-0">
        <SheetHeader className="h-16 justify-center border-b px-5">
          <SheetTitle asChild>
            <Link href="/" onClick={() => setOpen(false)} aria-label="Accueil Packio">
              <Logo />
            </Link>
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 p-3" aria-label="Navigation mobile">
          {MARKETING_LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[0.95rem] text-foreground/80 hover:bg-muted hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto grid gap-2 border-t p-4">
          <Button asChild variant="outline" size="lg" className="h-10">
            <Link href={account?.href ?? "/connexion"} onClick={() => setOpen(false)}>
              {account?.label ?? "Connexion"}
            </Link>
          </Button>
          <Button asChild size="lg" className="h-10">
            <Link href="/#tarifs" onClick={() => setOpen(false)}>
              Choisir une offre <ArrowRight />
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
