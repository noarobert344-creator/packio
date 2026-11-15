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
  if (location.type !== "BUSINESS_ADDRESS") {
    if (!location.network || !supplier.acceptedNetworks.includes(location.network)) {
      return { ok: false, reason: `${supplier.name} ne propose pas la livraison via ${networkLabel(location.network)}.` };
    }
  }
  return { ok: true };
}
