-- Supplément d'une commande livrée à une adresse (poste restante) et son remboursement.
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'DELIVERY_FEE';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'DELIVERY_FEE_REFUND';
