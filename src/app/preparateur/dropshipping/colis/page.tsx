import type { Metadata } from "next";
import { ShipmentsList } from "@/components/preparer/shipments-list";
import type { SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Colis à envoyer — dropshipping" };

export default async function DropshipShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
  return <ShipmentsList searchParams={searchParams} dropship />;
}
