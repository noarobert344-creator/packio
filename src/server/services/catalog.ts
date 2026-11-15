import type { CustomerStatus, LocationType, ParcelSize } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertAdmin, type Actor } from "@/server/auth/actor";
import { ALL_PERMISSIONS } from "@/server/auth/permissions";
import { audit } from "./audit";
import { normalizeEmail, sendInvitation, anonymizeUser } from "./auth";
import { saveSetting, type SettingKey, type Settings } from "./settings";

// ----------------------------------------------------------------------------- Offres

export type PlanInput = {
  code: string;
  name: string;
  tagline?: string | null;
  priceCents: number;
  monthlyCredits: number;
  storageLimit?: number | null;
  features: string[];
  highlighted: boolean;
  isActive: boolean;
  sortOrder: number;
};

export async function savePlan(actor: Actor, input: PlanInput & { id?: string }) {
  assertAdmin(actor, "billing.manage");
  const data = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    tagline: input.tagline?.trim() || null,
    priceCents: input.priceCents,
    monthlyCredits: input.monthlyCredits,
    storageLimit: input.storageLimit ?? null,
    features: input.features.map((f) => f.trim()).filter(Boolean),
    highlighted: input.highlighted,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  };
  const before = input.id ? await db.plan.findUnique({ where: { id: input.id } }) : null;
  const plan = input.id ? await db.plan.update({ where: { id: input.id }, data }) : await db.plan.create({ data });
  await audit({
    actor,
    action: input.id ? "plan.updated" : "plan.created",
    entityType: "plan",
    entityId: plan.id,
    summary: `${plan.name} — ${(plan.priceCents / 100).toFixed(2)} € / ${plan.monthlyCredits} crédits`,
    metadata: before ? { before: { priceCents: before.priceCents, monthlyCredits: before.monthlyCredits } } : undefined,
  });
  return { plan, priceChanged: !!before && before.priceCents !== plan.priceCents };
}

// ----------------------------------------------------------------------------- Catégories de colis

export async function saveSizeRules(
  actor: Actor,
  rules: { size: ParcelSize; label: string; description?: string | null; creditCost: number; maxLengthCm?: number | null; maxWidthCm?: number | null; maxHeightCm?: number | null; maxWeightGrams?: number | null }[],
) {
  assertAdmin(actor, "billing.manage");
  const order: ParcelSize[] = ["SMALL", "MEDIUM", "LARGE"];
  await db.$transaction(async (tx) => {
    for (const r of rules) {
      const data = {
        label: r.label.trim(),
        description: r.description?.trim() || null,
        creditCost: r.creditCost,
        maxLengthCm: r.maxLengthCm ?? null,
        maxWidthCm: r.maxWidthCm ?? null,
        maxHeightCm: r.maxHeightCm ?? null,
        maxWeightGrams: r.maxWeightGrams ?? null,
        sortOrder: order.indexOf(r.size),
      };
      await tx.parcelSizeRule.upsert({ where: { size: r.size }, create: { size: r.size, ...data }, update: data });
    }
    await audit({ actor, action: "size_rules.updated", entityType: "parcel_size_rule", summary: rules.map((r) => `${r.size}=${r.creditCost}`).join(", ") }, tx);
  });
}

// ----------------------------------------------------------------------------- Recharges

export async function saveCreditPack(actor: Actor, input: { id?: string; name: string; credits: number; priceCents: number; isActive: boolean; sortOrder: number }) {
  assertAdmin(actor, "billing.manage");
  const data = { name: input.name.trim(), credits: input.credits, priceCents: input.priceCents, isActive: input.isActive, sortOrder: input.sortOrder };
  const pack = input.id ? await db.creditPack.update({ where: { id: input.id }, data }) : await db.creditPack.create({ data });
  await audit({ actor, action: "credit_pack.saved", entityType: "credit_pack", entityId: pack.id, summary: `${pack.name}: ${pack.credits} crédits / ${(pack.priceCents / 100).toFixed(2)} €` });
  return pack;
}

// ----------------------------------------------------------------------------- Fournisseurs

export async function saveSupplier(
  actor: Actor,
  input: {
    id?: string;
    code: string;
    name: string;
    websiteUrl?: string | null;
    description?: string | null;
    acceptedLocationTypes: LocationType[];
    acceptedNetworks: string[];
    requiresPickupCode: boolean;
    compatibilityNotes?: string | null;
    isActive: boolean;
    sortOrder: number;
  },
) {
  assertAdmin(actor, "settings.manage");
  const data = {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    websiteUrl: input.websiteUrl?.trim() || null,
    description: input.description?.trim() || null,
    acceptedLocationTypes: input.acceptedLocationTypes,
    acceptedNetworks: input.acceptedNetworks,
    requiresPickupCode: input.requiresPickupCode,
    compatibilityNotes: input.compatibilityNotes?.trim() || null,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  };
  const supplier = input.id ? await db.supplier.update({ where: { id: input.id }, data }) : await db.supplier.create({ data });
  await audit({ actor, action: "supplier.saved", entityType: "supplier", entityId: supplier.id, summary: supplier.name });
  return supplier;
}

// ----------------------------------------------------------------------------- Paramètres

export async function updateSettings<K extends SettingKey>(actor: Actor, key: K, value: Settings[K]) {
  const permission = key === "notifications" ? "notifications.manage" : key === "creditPurchase" ? "billing.manage" : key === "credits" ? "credits.manage" : "settings.manage";
  assertAdmin(actor, permission);
  const saved = await saveSetting(key, value, actor.userId);
  await audit({ actor, action: "settings.updated", entityType: "setting", entityId: key, metadata: saved as object });
  return saved;
}

// ----------------------------------------------------------------------------- Rôles et équipe

export async function saveRole(actor: Actor, input: { id?: string; key: string; name: string; description?: string | null; permissions: string[] }) {
  assertAdmin(actor, "roles.manage");
  const permissions = input.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
  if (input.id) {
    const role = await db.role.findUnique({ where: { id: input.id } });
    if (!role) throw new NotFoundError();
    if (role.key === "super_admin") throw new DomainError("PROTECTED", "Le rôle super administrateur ne peut pas être modifié.");
    const updated = await db.role.update({ where: { id: input.id }, data: { name: input.name.trim(), description: input.description?.trim() || null, permissions } });
    await audit({ actor, action: "role.updated", entityType: "role", entityId: role.id, summary: permissions.join(", ") });
    return updated;
  }
  const created = await db.role.create({
    data: { key: input.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"), name: input.name.trim(), description: input.description?.trim() || null, permissions },
  });
  await audit({ actor, action: "role.created", entityType: "role", entityId: created.id, summary: created.name });
  return created;
}

export async function inviteAdmin(actor: Actor, input: { email: string; firstName: string; lastName: string; roleId: string }) {
  assertAdmin(actor, "roles.manage");
  const email = normalizeEmail(input.email);
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new DomainError("EMAIL_TAKEN", "Adresse déjà utilisée.");
  const role = await db.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new NotFoundError("Rôle introuvable.");
  if (role.key === "super_admin" && !actor.permissions.includes("*")) throw new DomainError("FORBIDDEN", "Seul un super administrateur peut nommer un super administrateur.");
  const user = await db.user.create({ data: { email, role: "ADMIN", staffRoleId: role.id, firstName: input.firstName.trim(), lastName: input.lastName.trim() } });
  await audit({ actor, action: "admin.invited", entityType: "user", entityId: user.id, summary: `${email} (${role.name})` });
  const { url } = await sendInvitation(user.id);
  return { user, invitationUrl: url };
}

export async function setStaffRole(actor: Actor, input: { userId: string; roleId: string }) {
  assertAdmin(actor, "roles.manage");
  const [user, role] = await Promise.all([db.user.findUnique({ where: { id: input.userId }, include: { staffRole: true } }), db.role.findUnique({ where: { id: input.roleId } })]);
  if (!user || user.role !== "ADMIN" || !role) throw new NotFoundError();
  if (user.staffRole?.key === "super_admin" && role.key !== "super_admin") {
    const supers = await db.user.count({ where: { role: "ADMIN", status: "ACTIVE", staffRole: { key: "super_admin" } } });
    if (supers <= 1) throw new DomainError("LAST_SUPER_ADMIN", "Impossible : il doit rester au moins un super administrateur.");
  }
  await db.user.update({ where: { id: user.id }, data: { staffRoleId: role.id } });
  await db.session.deleteMany({ where: { userId: user.id } });
  await audit({ actor, action: "admin.role_changed", entityType: "user", entityId: user.id, summary: role.name });
}

// ----------------------------------------------------------------------------- Clients

export async function setCustomerStatus(actor: Actor, input: { customerId: string; status: Extract<CustomerStatus, "SUSPENDED" | "ACTIVE">; reason: string }) {
  assertAdmin(actor, "customers.manage");
  const customer = await db.customerProfile.findUnique({ where: { id: input.customerId }, include: { subscriptions: true } });
  if (!customer) throw new NotFoundError();
  let status: CustomerStatus = input.status;
  if (input.status === "ACTIVE") {
    const subs = customer.subscriptions.map((s) => s.status);
    status = subs.some((s) => s === "ACTIVE" || s === "TRIALING") ? "ACTIVE" : subs.some((s) => s === "PAST_DUE" || s === "UNPAID") ? "PAST_DUE" : subs.length ? "CANCELED" : "PENDING_PAYMENT";
  }
  await db.customerProfile.update({ where: { id: customer.id }, data: { status } });
  await db.user.update({ where: { id: customer.userId }, data: { status: input.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE" } });
  if (input.status === "SUSPENDED") await db.session.deleteMany({ where: { userId: customer.userId } });
  await audit({ actor, action: "customer.status", entityType: "customer", entityId: customer.id, summary: `${status} — ${input.reason}` });
}

export async function updateCustomerNotes(actor: Actor, input: { customerId: string; notes: string }) {
  assertAdmin(actor, "customers.manage");
  await db.customerProfile.update({ where: { id: input.customerId }, data: { adminNotes: input.notes.trim() || null } });
  await audit({ actor, action: "customer.notes", entityType: "customer", entityId: input.customerId });
}

export async function anonymizeCustomer(actor: Actor, customerId: string) {
  assertAdmin(actor, "customers.manage");
  const customer = await db.customerProfile.findUnique({ where: { id: customerId } });
  if (!customer) throw new NotFoundError();
  await anonymizeUser(actor.userId, customer.userId);
}

/** Export des données personnelles d'un client (portabilité RGPD). */
export async function exportCustomerData(customerId: string) {
  const customer = await db.customerProfile.findUniqueOrThrow({
    where: { id: customerId },
    include: {
      user: { select: { email: true, firstName: true, lastName: true, phone: true, createdAt: true } },
      subscriptions: { include: { plan: { select: { name: true } } } },
      supplierOrders: { include: { events: true } },
      inventoryItems: { include: { movements: true } },
      shipments: { include: { items: true, events: true } },
      payments: true,
      invoices: true,
      wallet: { include: { transactions: true } },
    },
  });
  return { exportedAt: new Date().toISOString(), ...customer };
}
