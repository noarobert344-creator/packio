-- =============================================================================
-- PACKIO — Contraintes d'intégrité complémentaires (non exprimables en Prisma)
-- =============================================================================

-- 1. Index partiels uniques ----------------------------------------------------

-- Au plus une affectation ACTIVE par client (l'attribution reste manuelle).
CREATE UNIQUE INDEX "preparer_assignments_one_active_per_customer"
  ON "preparer_assignments" ("customerId") WHERE "status" = 'ACTIVE';

-- Une seule réservation de crédits en cours et une seule capture par expédition :
-- protège contre le double débit (double clic, requêtes concurrentes).
CREATE UNIQUE INDEX "credit_reservations_one_held_per_shipment"
  ON "credit_reservations" ("shipmentId") WHERE "status" = 'HELD';
CREATE UNIQUE INDEX "credit_reservations_one_captured_per_shipment"
  ON "credit_reservations" ("shipmentId") WHERE "status" = 'CAPTURED';

-- Un seul lieu de réception principal actif par préparateur.
CREATE UNIQUE INDEX "preparer_locations_one_primary"
  ON "preparer_locations" ("preparerId") WHERE "isPrimary" = true AND "isActive" = true;

-- Une seule conversation client/préparateur par binôme.
CREATE UNIQUE INDEX "conversations_one_per_pair"
  ON "conversations" ("customerId", "preparerId") WHERE "type" = 'CUSTOMER_PREPARER';

-- Recherche plein texte dans les messages (français).
CREATE INDEX "messages_body_fts" ON "messages" USING GIN (to_tsvector('french', "body"));

-- 2. Contraintes CHECK ---------------------------------------------------------

ALTER TABLE "credit_wallets"
  ADD CONSTRAINT "credit_wallets_non_negative" CHECK (
    "monthlyBalance" >= 0 AND "purchasedBalance" >= 0 AND "reservedBalance" >= 0 AND "consumedTotal" >= 0
  );

ALTER TABLE "credit_lots"
  ADD CONSTRAINT "credit_lots_amounts" CHECK (
    "initialAmount" > 0 AND "remaining" >= 0 AND "remaining" <= "initialAmount"
  );

ALTER TABLE "credit_reservations"
  ADD CONSTRAINT "credit_reservations_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_quantities_non_negative" CHECK (
    "quantityReceived" >= 0 AND "quantityAvailable" >= 0 AND "quantityReserved" >= 0
    AND "quantityShipped" >= 0 AND "quantityDamaged" >= 0 AND "quantityMissing" >= 0
  );

ALTER TABLE "shipment_items"
  ADD CONSTRAINT "shipment_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "supplier_orders"
  ADD CONSTRAINT "supplier_orders_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "plans"
  ADD CONSTRAINT "plans_values_non_negative" CHECK ("priceCents" >= 0 AND "monthlyCredits" >= 0);

ALTER TABLE "credit_packs"
  ADD CONSTRAINT "credit_packs_values" CHECK ("credits" > 0 AND "priceCents" >= 0);

ALTER TABLE "parcel_size_rules"
  ADD CONSTRAINT "parcel_size_rules_cost_non_negative" CHECK ("creditCost" >= 0);

ALTER TABLE "preparer_profiles"
  ADD CONSTRAINT "preparer_profiles_capacity_non_negative" CHECK ("maxClients" >= 0 AND "storageCapacity" >= 0);

ALTER TABLE "outbound_shipments"
  ADD CONSTRAINT "outbound_shipments_credit_cost_non_negative" CHECK ("creditCost" IS NULL OR "creditCost" >= 0);

-- 3. Registres en ajout seul ---------------------------------------------------
-- Les opérations passées ne peuvent être ni modifiées ni supprimées : toute
-- correction passe par une nouvelle écriture compensatoire.

CREATE OR REPLACE FUNCTION packio_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La table % est un registre en ajout seul : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "credit_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "credit_transactions"
  FOR EACH ROW EXECUTE FUNCTION packio_forbid_mutation();

CREATE TRIGGER "inventory_movements_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION packio_forbid_mutation();

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION packio_forbid_mutation();

CREATE TRIGGER "shipment_events_append_only"
  BEFORE UPDATE OR DELETE ON "shipment_events"
  FOR EACH ROW EXECUTE FUNCTION packio_forbid_mutation();

CREATE TRIGGER "supplier_order_events_append_only"
  BEFORE UPDATE OR DELETE ON "supplier_order_events"
  FOR EACH ROW EXECUTE FUNCTION packio_forbid_mutation();
