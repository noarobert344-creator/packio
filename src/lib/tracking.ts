/**
 * Liens de suivi publics des transporteurs. Lorsqu'une API officielle est
 * configurée (ex. La Poste / Colissimo), le statut est synchronisé
 * automatiquement ; sinon le suivi est renseigné manuellement.
 */
const TRACKING_URLS: Record<string, (n: string) => string> = {
  COLISSIMO: (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`,
  LA_POSTE: (n) => `https://www.laposte.fr/outils/suivre-vos-envois?code=${n}`,
  CHRONOPOST: (n) => `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${n}`,
  MONDIAL_RELAY: (n) => `https://www.mondialrelay.fr/suivi-de-colis/?NumeroExpedition=${n}`,
  DPD: (n) => `https://trace.dpd.fr/fr/trace/${n}`,
  GLS: (n) => `https://gls-group.com/FR/fr/suivi-colis?match=${n}`,
  UPS: (n) => `https://www.ups.com/track?loc=fr_FR&tracknum=${n}`,
  DHL: (n) => `https://www.dhl.com/fr-fr/home/tracking/tracking-parcel.html?submit=1&tracking-id=${n}`,
  FEDEX: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  INPOST: (n) => `https://inpost.fr/suivi-colis?number=${n}`,
  RELAIS_COLIS: (n) => `https://www.relaiscolis.com/suivi-de-colis/?reference=${n}`,
  COLIS_PRIVE: (n) => `https://www.colisprive.com/moncolis/pages/detailColis.aspx?numColis=${n}`,
  CAINIAO: (n) => `https://global.cainiao.com/newDetail.htm?mailNoList=${n}`,
};

export function trackingUrl(carrier: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  if (!carrier || !trackingNumber) return null;
  const build = TRACKING_URLS[carrier];
  return build ? build(encodeURIComponent(trackingNumber.trim())) : null;
}
