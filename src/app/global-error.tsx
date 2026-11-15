"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Une erreur inattendue est survenue</h1>
          <p style={{ color: "#71717a", fontSize: 14 }}>Veuillez réessayer dans quelques instants.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "10px 16px", borderRadius: 10, border: 0, background: "#2f4dff", color: "#fff", cursor: "pointer" }}>
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
