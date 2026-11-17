-- Crédits débités pour une commande livrée à une adresse (poste restante, domiciliation).
ALTER TABLE "supplier_orders" ADD COLUMN "addressCreditsCharged" INTEGER NOT NULL DEFAULT 0;
