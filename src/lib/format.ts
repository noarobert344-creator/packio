import { format, formatDistanceToNowStrict } from "date-fns";
import { fr } from "date-fns/locale";

export function formatDate(d: Date | string | null | undefined, pattern = "d MMM yyyy") {
  if (!d) return "—";
  return format(typeof d === "string" ? new Date(d) : d, pattern, { locale: fr });
}

export function formatDateTime(d: Date | string | null | undefined) {
  return formatDate(d, "d MMM yyyy 'à' HH:mm");
}

export function formatRelative(d: Date | string | null | undefined) {
  if (!d) return "—";
  return formatDistanceToNowStrict(typeof d === "string" ? new Date(d) : d, { locale: fr, addSuffix: true });
}

export function formatMoney(cents: number | null | undefined, currency = "eur") {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

/** Prix affiché sans décimales lorsqu'il est rond (« 299 € », « 29,90 € »). */
export function formatPrice(cents: number | null | undefined, currency = "eur") {
  if (cents === null || cents === undefined) return "—";
  const round = cents % 100 === 0;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: round ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export function formatCredits(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${n} crédit${Math.abs(n) > 1 ? "s" : ""}`;
}

export function formatDuration(minutes: number) {
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 48) return `${Math.floor(h / 24)} j ${h % 24} h`;
  if (h > 0) return `${h} h ${String(r).padStart(2, "0")}`;
  return `${r} min`;
}

export function initials(first?: string | null, last?: string | null) {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "?";
}

export function fullName(u: { firstName: string; lastName: string } | null | undefined) {
  return u ? `${u.firstName} ${u.lastName}` : "—";
}

export function formatAddress(a: { addressLine1: string; addressLine2?: string | null; postalCode: string; city: string; country?: string | null }) {
  return [a.addressLine1, a.addressLine2, `${a.postalCode} ${a.city}`, a.country && a.country !== "FR" ? a.country : null].filter(Boolean).join(", ");
}
