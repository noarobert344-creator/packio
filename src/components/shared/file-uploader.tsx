"use client";

import { useRef, useState } from "react";
import { FileText, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type UploadedFile = { id: string; filename: string; mimeType: string };

type Purpose =
  | "AVATAR"
  | "PRODUCT_PHOTO"
  | "ORDER_PHOTO"
  | "RECEPTION_PHOTO"
  | "PREPARATION_PHOTO"
  | "SHIPPING_LABEL"
  | "MESSAGE_ATTACHMENT"
  | "INCIDENT_ATTACHMENT";

export async function uploadToPackio(file: File, purpose: Purpose, customerId?: string): Promise<UploadedFile> {
  const body = new FormData();
  body.append("file", file);
  body.append("purpose", purpose);
  if (customerId) body.append("customerId", customerId);
  const res = await fetch("/api/uploads", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & Partial<UploadedFile>;
  if (!res.ok || !json.id) throw new Error(json.error ?? "Échec du téléversement");
  return { id: json.id, filename: json.filename!, mimeType: json.mimeType! };
}

/**
 * Téléversement de photos / documents : chaque fichier est envoyé
 * immédiatement, et son identifiant est ajouté au formulaire parent via des
 * champs cachés `${name}[]`.
 */
export function FileUploader({
  name = "photoIds",
  purpose,
  customerId,
  max = 6,
  accept = "image/*",
  label = "Ajouter des photos",
  hint = "JPEG, PNG, WebP ou HEIC — 10 Mo max.",
  capture,
  onChange,
}: {
  name?: string;
  purpose: Purpose;
  customerId?: string;
  max?: number;
  accept?: string;
  label?: string;
  hint?: string;
  capture?: boolean;
  onChange?: (files: UploadedFile[]) => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  async function handle(list: FileList | null) {
    if (!list) return;
    const selected = Array.from(list).slice(0, Math.max(0, max - files.length));
    setBusy((b) => b + selected.length);
    for (const f of selected) {
      try {
        const uploaded = await uploadToPackio(f, purpose, customerId);
        setFiles((prev) => {
          const next = [...prev, uploaded];
          onChange?.(next);
          return next;
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Échec du téléversement");
      } finally {
        setBusy((b) => b - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {files.map((f) => (
          <div key={f.id} className="group relative size-20 overflow-hidden rounded-xl border bg-muted">
            {f.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${f.id}`} alt={f.filename} className="size-full object-cover" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[0.65rem] text-muted-foreground">
                <FileText className="size-5" />
                <span className="line-clamp-2 break-all">{f.filename}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                setFiles((prev) => {
                  const next = prev.filter((x) => x.id !== f.id);
                  onChange?.(next);
                  return next;
                })
              }
              className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5 shadow-sm"
              aria-label={`Retirer ${f.filename}`}
            >
              <X className="size-3.5" />
            </button>
            <input type="hidden" name={`${name}[]`} value={f.id} />
          </div>
        ))}
        {files.length < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={cn(
              "flex size-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-[0.7rem] text-muted-foreground transition-colors hover:border-brand hover:text-brand",
              busy > 0 && "pointer-events-none opacity-70",
            )}
          >
            {busy > 0 ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
            <span className="px-1 text-center leading-tight">{busy > 0 ? "Envoi…" : label}</span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={max > 1}
        capture={capture ? "environment" : undefined}
        className="sr-only"
        onChange={(e) => handle(e.target.files)}
        tabIndex={-1}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function FileThumbs({ files, size = "md" }: { files: { id: string; filename: string; mimeType: string }[]; size?: "sm" | "md" | "lg" }) {
  if (!files.length) return null;
  const dim = size === "sm" ? "size-12" : size === "lg" ? "size-28" : "size-20";
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f) => (
        <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className={cn("overflow-hidden rounded-xl border bg-muted transition-opacity hover:opacity-90", dim)} title={f.filename}>
          {f.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${f.id}`} alt={f.filename} className="size-full object-cover" loading="lazy" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[0.6rem] text-muted-foreground">
              <FileText className="size-4" />
              <span className="line-clamp-2 break-all">{f.filename}</span>
            </div>
          )}
        </a>
      ))}
    </div>
  );
}
