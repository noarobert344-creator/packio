import type { LocationType } from "@/generated/prisma/enums";
import { LOCATION_TYPE, networkLabel } from "./labels";

export type SupplierCompat = { name: string; acceptedLocationTypes: LocationType[]; acceptedNetworks: string[] };
export type LocationCompat = { type: LocationType; network: string | null };

/**
 * Vérifie qu'un fournisseur peut livrer vers un point de réception donné.
 * Les règles sont configurées par l'administrateur (fournisseur → types de
 * points et réseaux acceptés) ; on ne suppose jamais qu'un fournisseur livre
 * vers n'importe quel locker.
 */
export function checkCompatibility(supplier: SupplierCompat, location: LocationCompat): { ok: true } | { ok: false; reason: string } {
  if (!supplier.acceptedLocationTypes.includes(location.type)) {
    return { ok: false, reason: `${supplier.name} ne livre pas vers un point de type « ${LOCATION_TYPE[location.type]} ».` };
  }
  // Lockers et points relais : le réseau doit aussi être accepté. Adresse et poste restante : le type suffit.
  if (location.type === "LOCKER" || location.type === "RELAY_POINT") {
    if (!location.network || !supplier.acceptedNetworks.includes(location.network)) {
      return { ok: false, reason: `${supplier.name} ne propose pas la livraison via ${networkLabel(location.network)}.` };
    }
  }
  return { ok: true };
}

/** Valeur du point d'arrivée « un autre point relais ou locker (à préciser) ». */
export const ARRIVAL_OTHER = "AUTRE";

/**
 * Points de réception « à une adresse » (poste restante, domiciliation) : le
 * fournisseur livre comme à domicile. Une commande livrée ainsi coûte un
 * supplément en crédits ; points relais et lockers : aucun supplément.
 */
export const ADDRESS_LOCATION_TYPES: LocationType[] = ["POST_OFFICE", "BUSINESS_ADDRESS"];
