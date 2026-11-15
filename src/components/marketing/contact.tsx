import { Clock3, LifeBuoy, Mail, MessagesSquare, Phone } from "lucide-react";
import { Container, SectionHeading } from "./section";
import { ContactForm } from "./contact-form";

export function Contact({ support }: { support: { email: string; phone: string; hours: string } }) {
  return (
    <section id="contact" className="scroll-mt-20 py-24 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-8">
          <SectionHeading
            align="left"
            eyebrow="Contact et support"
            title="Une question avant de vous lancer ?"
            description="Écrivez-nous : l'équipe Packio vous répond par e-mail. Une fois client, le support est accessible directement depuis votre messagerie."
          />
          <ul className="space-y-4 text-sm">
            <li className="flex items-center gap-3">
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Mail className="size-4" />
              </span>
              <a href={`mailto:${support.email}`} className="font-medium hover:underline">
                {support.email}
              </a>
            </li>
            {support.phone && (
              <li className="flex items-center gap-3">
                <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <Phone className="size-4" />
                </span>
                <a href={`tel:${support.phone.replace(/\s/g, "")}`} className="font-medium hover:underline">
                  {support.phone}
                </a>
              </li>
            )}
            <li className="flex items-center gap-3">
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Clock3 className="size-4" />
              </span>
              <span className="text-muted-foreground">{support.hours}</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <MessagesSquare className="size-4" />
              </span>
              <span className="text-muted-foreground">Clients : messagerie support dans votre espace</span>
            </li>
          </ul>
        </div>
        <div className="relative rounded-3xl border bg-card p-6 shadow-soft sm:p-8">
          <div className="mb-6 flex items-center gap-2">
            <LifeBuoy className="size-4 text-brand" />
            <p className="font-semibold">Envoyer un message</p>
          </div>
          <ContactForm />
        </div>
      </Container>
    </section>
  );
}
