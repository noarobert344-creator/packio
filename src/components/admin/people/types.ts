export type CapacityOption = {
  id: string;
  name: string;
  city: string;
  country: string;
  status: string;
  maxClients: number;
  activeClients: number;
  storageCapacity: number;
  storedUnits: number;
  parcelsProcessed: number;
  validatedLocations: number;
  absentNow: boolean;
  available: boolean;
  unavailableReason: string | null;
};
