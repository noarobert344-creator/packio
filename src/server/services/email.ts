import { db } from "@/server/db";
import { env } from "@/server/env";

export type EmailMessage = {
  to: string;
  subject: string;
  template: string;
  title: string;
  /** Paragraphes du corps (texte brut, échappé à l'affichage). */
  paragraphs: string[];
  cta?: { label: string; url: string };
  userId?: string | null;
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderEmail(msg: Pick<EmailMessage, "title" | "paragraphs" | "cta">) {
  const body = msg.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#3f3f46">${escapeHtml(p)}</p>`).join("");
  const cta = msg.cta
    ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(msg.cta.url)}" style="display:inline-block;background:#2b4bff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(msg.cta.label)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e4e4e7">
<tr><td style="padding:28px 32px 8px"><span style="display:inline-block;font-weight:800;letter-spacing:0.18em;font-size:15px;color:#09090b">PACKIO</span></td></tr>
<tr><td style="padding:8px 32px 28px"><h1 style="margin:0 0 16px;font-size:20px;color:#09090b">${escapeHtml(msg.title)}</h1>${body}${cta}</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #f4f4f5;font-size:12px;color:#a1a1aa">Vous recevez cet e-mail car vous disposez d'un compte Packio. Gérez vos préférences de notification depuis vos paramètres.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [msg.title, "", ...msg.paragraphs, ...(msg.cta ? ["", `${msg.cta.label} : ${msg.cta.url}`] : [])].join("\n");
  return { html, text };
}

/**
 * Envoie un e-mail transactionnel via Resend (si RESEND_API_KEY est défini),
 * sinon le journalise (développement). Ne lève jamais d'exception.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const { html, text } = renderEmail(msg);
  if (!env.resendApiKey) {
    if (!env.isProduction && process.env.NODE_ENV !== "test") {
      console.info(`[email:dev] → ${msg.to} | ${msg.subject}`);
    }
    await db.emailLog
      .create({ data: { toEmail: msg.to, subject: msg.subject, template: msg.template, status: "LOGGED", provider: "log", userId: msg.userId ?? null } })
      .catch(() => undefined);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.emailFrom, to: [msg.to], subject: msg.subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    await db.emailLog.create({
      data: {
        toEmail: msg.to,
        subject: msg.subject,
        template: msg.template,
        status: res.ok ? "SENT" : "FAILED",
        provider: "resend",
        providerMessageId: payload.id ?? null,
        error: res.ok ? null : (payload.message ?? `HTTP ${res.status}`).slice(0, 500),
        userId: msg.userId ?? null,
      },
    });
  } catch (err) {
    await db.emailLog
      .create({
        data: {
          toEmail: msg.to,
          subject: msg.subject,
          template: msg.template,
          status: "FAILED",
          provider: "resend",
          error: String(err).slice(0, 500),
          userId: msg.userId ?? null,
        },
      })
      .catch(() => undefined);
  }
}
