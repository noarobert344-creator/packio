import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="space-y-2">
        <p className="text-sm font-medium text-brand">Erreur 404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Cette page est introuvable</h1>
        <p className="text-sm text-muted-foreground">Le lien est peut-être incorrect, ou l&apos;élément n&apos;est pas accessible avec votre compte.</p>
      </div>
      <Button asChild>
        <Link href="/">Retour à l&apos;accueil</Link>
      </Button>
    </div>
  );
}
