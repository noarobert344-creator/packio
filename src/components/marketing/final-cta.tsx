import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "./section";

export function FinalCta() {
  return (
    <section className="pb-24 sm:pb-28">
      <Container>
        <div data-reveal className="relative overflow-hidden rounded-3xl bg-[oklch(0.17_0.02_266)] px-6 py-14 text-center text-white sm:px-12 sm:py-20">
          <div className="absolute inset-0 bg-grid opacity-25 mask-radial" aria-hidden />
          <div className="absolute -bottom-40 left-1/2 size-[34rem] rounded-full bg-[oklch(0.53_0.255_266)] opacity-45 blur-3xl animate-aurora" aria-hidden />
          <div className="absolute -top-32 left-[30%] size-[22rem] rounded-full bg-[oklch(0.7_0.17_230)] opacity-20 blur-3xl animate-aurora-slow" aria-hidden />
          <div className="relative mx-auto max-w-2xl space-y-6">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Concentrez-vous sur vos ventes. Votre préparateur s&apos;occupe des colis.</h2>
            <p className="text-white/70">Choisissez votre offre en quelques minutes : votre préparateur vous est attribué sous 24 heures.</p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="btn-shine h-11 bg-white px-5 text-[0.95rem] text-[oklch(0.17_0.02_266)] hover:bg-white/90">
                <Link href="#tarifs">
                  Choisir une offre <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-11 px-5 text-[0.95rem] text-white hover:bg-white/10 hover:text-white">
                <Link href="#contact">Poser une question</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
