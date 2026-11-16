"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Durée maximale d'une note vocale (secondes). */
const MAX_SECONDS = 180;

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

/**
 * Note vocale : enregistrement au micro (MediaRecorder), puis envoi immédiat.
 * Rien n'est envoyé en cas d'annulation ; le micro est libéré dès l'arrêt.
 */
export function VoiceRecorder({ disabled, onRecorded }: { disabled?: boolean; onRecorded: (file: File) => void | Promise<void> }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function start() {
    const mimeType = pickMimeType();
    if (mimeType === null || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Votre navigateur ne permet pas d'enregistrer une note vocale.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Accès au micro refusé : autorisez-le dans votre navigateur pour envoyer une note vocale.");
      return;
    }
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      setRecording(false);
      if (cancelled.current || !chunks.current.length) return;
      const type = rec.mimeType || mimeType || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "weba";
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      onRecorded(new File(chunks.current, `note-vocale-${stamp}.${ext}`, { type: type.split(";")[0] }));
    };
    recorder.current = rec;
    rec.start(250);
    setSeconds(0);
    setRecording(true);
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) recorder.current?.stop();
        return s + 1;
      });
    }, 1000);
  }

  function stop(cancel: boolean) {
    cancelled.current = cancel;
    recorder.current?.stop();
  }

  if (!recording) {
    return (
      <Button type="button" variant="ghost" size="icon" onClick={start} disabled={disabled} aria-label="Enregistrer une note vocale">
        <Mic />
      </Button>
    );
  }
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="flex items-center gap-1 rounded-full bg-danger-soft px-2 py-1 text-danger" role="status" aria-live="polite">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
      </span>
      <span className="w-10 text-center text-xs font-medium tabular">{time}</span>
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => stop(true)} aria-label="Annuler la note vocale">
        <Trash2 />
      </Button>
      <Button type="button" size="icon-sm" onClick={() => stop(false)} aria-label="Arrêter et envoyer la note vocale">
        {seconds < 1 ? <Square /> : <Send />}
      </Button>
    </div>
  );
}
