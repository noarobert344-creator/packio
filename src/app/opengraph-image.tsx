import { ImageResponse } from "next/og";

export const alt = "Packio — Votre logistique e-commerce, déléguée à un préparateur attitré";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #0e1220 0%, #141a33 55%, #2f4dff 140%)",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="72" height="72" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8.5" fill="#2f4dff" />
            <path d="M10.5 24.5V7.5h8.25a4.75 4.75 0 0 1 0 9.5H10.5" fill="none" stroke="#fff" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14.75 7.5v9.5" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
            <rect x="18.6" y="20.4" width="4.6" height="4.6" rx="1.3" fill="#fff" />
          </svg>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: 8 }}>PACKIO</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 700, lineHeight: 1.08, maxWidth: 980 }}>Votre logistique e-commerce, déléguée à un préparateur attitré.</div>
          <div style={{ display: "flex", fontSize: 30, color: "rgba(255,255,255,0.72)" }}>Réception · Stockage · Expédition · Suivi en temps réel</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
