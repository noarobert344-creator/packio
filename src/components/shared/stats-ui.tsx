import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

export function monthLabel(key: string, pattern = "MMMM yyyy") {
  return formatDate(new Date(`${key}-01T12:00:00`), pattern);
}

/** Lien de téléchargement d'un export CSV. */
export function CsvLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} download>
        <Download /> {label}
      </a>
    </Button>
  );
}
