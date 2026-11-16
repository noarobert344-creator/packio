import type { Metadata } from "next";
import { ShipmentsList } from "@/components/preparer/shipments-list";
import type { SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Colis à envoyer" };

export default async function PreparerShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
  return <ShipmentsList searchParams={searchParams} dropship={false} />;
}
