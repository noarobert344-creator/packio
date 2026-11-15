"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label = "Copier", successMessage = "Copié dans le presse-papiers", variant = "outline", size = "sm", className }: {
  value: string;
  label?: string;
  successMessage?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(successMessage);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          toast.error("Copie impossible : sélectionnez le texte manuellement.");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {label}
    </Button>
  );
}
