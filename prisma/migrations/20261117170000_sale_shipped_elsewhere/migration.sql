-- Vente expédiée en dehors de Packio (la plateforme indique le colis parti).
ALTER TYPE "MarketplaceSaleStatus" ADD VALUE IF NOT EXISTS 'SHIPPED_ELSEWHERE';
