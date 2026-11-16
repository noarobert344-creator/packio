"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Download, Link2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createExtensionTokenAction } from "@/server/actions/marketplace";

type Detection = "pending" | "found" | "missing";
type Status = { kind: "idle" } | { kind: "busy" } | { kind: "done"; text: string } | { kind: "error"; text: string };

/**
 * Installation et connexion de Packio Connect en un clic : la page crée un
 * jeton et le transmet à l'extension (script connect.js), sans copier-coller.
 */
export function ExtensionConnect({ storeUrl }: { storeUrl: string | null }) {
  const router = useRouter();
  const [detection, setDetection] = useState<Detection>("pending");
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const pending = useRef<((r: { ok: boolean; error: string | null; referenceCode: string | null }) => void) | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; version?: string; ok?: boolean; error?: string | null; referenceCode?: string | null } | null;
      if (data?.source !== "packio-connect") return;
      if (data.type === "ready") {
        setDetection("found");
        setVersion(data.version ?? null);
      }
      if (data.type === "connect-result" && pending.current) {
        pending.current({ ok: !!data.ok, error: data.error ?? null, referenceCode: data.referenceCode ?? null });
        pending.current = null;
      }
    };
    window.addEventListener("message", onMessage);
    const ping = () => window.postMessage({ source: "packio-page", type: "ping" }, window.location.origin);
    ping();
    const retry = window.setTimeout(ping, 1200);
    const giveUp = window.setTimeout(() => setDetection((d) => (d === "pending" ? "missing" : d)), 2500);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(retry);
      window.clearTimeout(giveUp);
    };
  }, []);

  const connect = useCallback(async () => {
    setStatus({ kind: "busy" });
    const form = new FormData();
    form.set("label", "Connexion automatique (navigateur)");
    const created = await createExtensionTokenAction(null, form);
    if (!created?.ok || !created.data?.token) {
      setStatus({ kind: "error", text: created && !created.ok ? created.error : "Création du jeton impossible." });
      return;
    }
    const result = await new Promise<{ ok: boolean; error: string | null; referenceCode: string | null }>((resolve) => {
      pending.current = resolve;
      window.postMessage({ source: "packio-page", type: "connect", token: created.data!.token }, window.location.origin);
      window.setTimeout(() => {
        if (pending.current === resolve) {
          pending.current = null;
          resolve({ ok: false, error: "L'extension n'a pas répondu. Rechargez la page et réessayez.", referenceCode: null });
        }
      }, 15000);
    });
    if (result.ok) {
      setStatus({ kind: "done", text: `Extension connectée${result.referenceCode ? ` au compte ${result.referenceCode}` : ""} : vos ventes Vinted et Vestiaire Collective remonteront automatiquement.` });
      router.refresh();
    } else {
      setStatus({ kind: "error", text: result.error ?? "Connexion impossible." });
    }
  }, [router]);

  return (
    <ol className="grid gap-4">
      <li className="grid gap-2">
        <p className="text-sm font-medium">1. Installez Packio Connect</p>
        <div className="flex flex-wrap items-center gap-3">
          {detection === "found" ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <CircleCheck className="size-4" /> Extension installée sur ce navigateur{version ? ` (version ${version})` : ""}
            </span>
          ) : storeUrl ? (
            <Button asChild>
              <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                <Download /> Installer depuis le Chrome Web Store
              </a>
            </Button>
          ) : (
            <Button disabled variant="outline">
              <Download /> Bientôt sur le Chrome Web Store
            </Button>
          )}
          {detection === "missing" && (
            <span className="text-xs text-muted-foreground">
              {storeUrl ? "Après l'installation, rechargez cette page. " : ""}Fonctionne avec Chrome, Edge ou Brave sur ordinateur.
            </span>
          )}
        </div>
      </li>
      <li className="grid gap-2">
        <p className="text-sm font-medium">2. Connectez-la à votre compte, en un clic</p>
        <div>
          <Button onClick={connect} disabled={detection !== "found" || status.kind === "busy"}>
            {status.kind === "busy" ? <Loader2 className="animate-spin" /> : <Link2 />} Connecter l&apos;extension
          </Button>
        </div>
        {status.kind === "done" && (
          <p className="flex items-start gap-2 rounded-xl bg-success-soft p-3 text-sm text-success">
            <CircleCheck className="mt-0.5 size-4 shrink-0" /> {status.text}
          </p>
        )}
        {status.kind === "error" && (
          <p className="flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {status.text}
          </p>
        )}
      </li>
      <li className="text-sm">
        <span className="font-medium">3. Restez connecté à Vinted ou Vestiaire Collective</span>
        <span className="text-muted-foreground"> dans ce navigateur : vos ventes et bordereaux remontent toutes les 15 minutes.</span>
      </li>
    </ol>
  );
}
