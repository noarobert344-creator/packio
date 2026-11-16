"use client";

import { useEffect } from "react";

/**
 * Effets de la page d'accueil, sans dépendance :
 * - apparition au défilement des éléments marqués `data-reveal` (décalage
 *   facultatif via la variable CSS `--d`) ;
 * - halo qui suit le pointeur sur les cartes marquées `data-spotlight`.
 * Rien n'est masqué tant que ce script n'a pas démarré, ni si l'appareil
 * demande moins d'animations.
 */
export function MotionEffects() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let observer: IntersectionObserver | null = null;

    if (!reduced && "IntersectionObserver" in window) {
      const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
      // Ce qui est déjà à l'écran reste affiché (pas de clignotement).
      const limit = window.innerHeight * 0.92;
      for (const el of elements) if (el.getBoundingClientRect().top < limit) el.dataset.revealed = "";
      root.dataset.revealReady = "";
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            (entry.target as HTMLElement).dataset.revealed = "";
            observer?.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
      );
      for (const el of elements) if (!("revealed" in el.dataset)) observer.observe(el);
    }

    const onPointerMove = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>("[data-spotlight]");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      observer?.disconnect();
      delete root.dataset.revealReady;
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, []);
  return null;
}
