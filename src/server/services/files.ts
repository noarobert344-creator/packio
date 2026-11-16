import { createHash, randomUUID } from "node:crypto";
import type { File as FileRow } from "@/generated/prisma/client";
import type { FilePurpose } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/auth/actor";
import { storage } from "@/server/storage";
import { getConversationAccess } from "./messaging";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"] as const;
const DOC_TYPES = ["application/pdf"] as const;

const ALLOWED_BY_PURPOSE: Record<FilePurpose, readonly string[]> = {
  AVATAR: ["image/jpeg", "image/png", "image/webp"],
  PRODUCT_PHOTO: IMAGE_TYPES,
  ORDER_PHOTO: IMAGE_TYPES,
  RECEPTION_PHOTO: IMAGE_TYPES,
  PREPARATION_PHOTO: IMAGE_TYPES,
  SHIPPING_LABEL: [...DOC_TYPES, ...IMAGE_TYPES],
  MESSAGE_ATTACHMENT: [...IMAGE_TYPES, ...DOC_TYPES],
  INCIDENT_ATTACHMENT: [...IMAGE_TYPES, ...DOC_TYPES],
};

/** Détection du type réel par signature binaire (le type déclaré n'est pas fiable). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

function cleanFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "fichier";
  return base.replace(/[^\p{L}\p{N}._\- ]/gu, "_").slice(0, 120) || "fichier";
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export async function uploadFile(actor: Actor, input: { purpose: FilePurpose; filename: string; data: Buffer; customerId?: string | null }) {
  if (input.data.length === 0) throw new DomainError("EMPTY", "Fichier vide.");
  if (input.data.length > MAX_UPLOAD_BYTES) throw new DomainError("TOO_LARGE", "Fichier trop volumineux (10 Mo maximum).");
  const mime = sniffMime(input.data);
  if (!mime || !ALLOWED_BY_PURPOSE[input.purpose].includes(mime)) {
    throw new DomainError("TYPE", "Format non autorisé. Formats acceptés : JPEG, PNG, WebP, HEIC" + (ALLOWED_BY_PURPOSE[input.purpose].includes("application/pdf") ? ", PDF." : "."));
  }

  let customerId: string | null = null;
  let preparerId: string | null = null;
  if (actor.role === "CUSTOMER") {
    customerId = actor.customerId;
    const c = await db.customerProfile.findUnique({ where: { id: actor.customerId! }, select: { currentPreparerId: true } });
    preparerId = c?.currentPreparerId ?? null;
  } else if (actor.role === "PREPARER") {
    preparerId = actor.preparerId;
    if (input.customerId) {
      const related =
        (await db.preparerAssignment.count({ where: { preparerId: actor.preparerId!, customerId: input.customerId, status: "ACTIVE" } })) +
        (await db.supplierOrder.count({ where: { preparerId: actor.preparerId!, customerId: input.customerId } })) +
        (await db.outboundShipment.count({ where: { preparerId: actor.preparerId!, customerId: input.customerId } }));
      if (!related) throw new ForbiddenError("Ce client ne vous est pas attribué.");
      customerId = input.customerId;
    }
  } else if (actor.role === "ADMIN") {
    customerId = input.customerId ?? null;
  }

  const id = randomUUID();
  const storageKey = `${new Date().toISOString().slice(0, 7)}/${id}.${EXT[mime] ?? "bin"}`;
  await storage().put(storageKey, input.data, mime);
  const file = await db.file.create({
    data: {
      storageKey,
      filename: cleanFilename(input.filename),
      mimeType: mime,
      sizeBytes: input.data.length,
      sha256: createHash("sha256").update(input.data).digest("hex"),
      purpose: input.purpose,
      uploadedById: actor.userId,
      customerId,
      preparerId,
    },
  });
  if (input.purpose === "AVATAR") {
    const previous = await db.user.findUnique({ where: { id: actor.userId }, select: { avatarFileId: true } });
    await db.user.update({ where: { id: actor.userId }, data: { avatarFileId: file.id } });
    if (previous?.avatarFileId) await db.file.update({ where: { id: previous.avatarFileId }, data: { deletedAt: new Date() } });
  }
  return file;
}

/** Contrôle d'accès en lecture à un fichier. */
export async function assertCanReadFile(actor: Actor, file: FileRow & { avatarOf?: { id: string; role: string } | null }) {
  if (file.deletedAt) throw new NotFoundError("Fichier introuvable.");
  if (file.uploadedById === actor.userId) return;

  if (file.conversationId) {
    await getConversationAccess(actor, file.conversationId);
    return;
  }
  if (file.purpose === "AVATAR" && file.avatarOf) {
    if (actor.role === "ADMIN") return;
    const owner = file.avatarOf;
    if (actor.role === "CUSTOMER") {
      const c = await db.customerProfile.findUnique({ where: { id: actor.customerId! }, include: { currentPreparer: { select: { userId: true } } } });
      if (c?.currentPreparer?.userId === owner.id) return;
    }
    if (owner.role === "CUSTOMER" && actor.role === "PREPARER") {
      const c = await db.customerProfile.findUnique({ where: { userId: owner.id }, select: { currentPreparerId: true } });
      if (c?.currentPreparerId === actor.preparerId) return;
    }
    throw new ForbiddenError();
  }
  if (actor.role === "ADMIN") return;
  if (actor.role === "CUSTOMER") {
    if (file.customerId && file.customerId === actor.customerId) return;
    throw new ForbiddenError();
  }
  if (actor.role === "PREPARER") {
    if (file.preparerId === actor.preparerId) return;
    const linked = await Promise.all([
      file.supplierOrderId ? db.supplierOrder.findFirst({ where: { id: file.supplierOrderId, preparerId: actor.preparerId! }, select: { id: true } }) : null,
      file.shipmentId ? db.outboundShipment.findFirst({ where: { id: file.shipmentId, preparerId: actor.preparerId! }, select: { id: true } }) : null,
      file.inventoryItemId ? db.inventoryItem.findFirst({ where: { id: file.inventoryItemId, preparerId: actor.preparerId! }, select: { id: true } }) : null,
      file.incidentId ? db.incident.findFirst({ where: { id: file.incidentId, preparerId: actor.preparerId! }, select: { id: true } }) : null,
    ]);
    if (linked.some(Boolean)) return;
  }
  throw new ForbiddenError();
}

export async function getFileForDownload(actor: Actor, id: string) {
  const file = await db.file.findUnique({ where: { id }, include: { avatarOf: { select: { id: true, role: true } } } });
  if (!file) throw new NotFoundError("Fichier introuvable.");
  await assertCanReadFile(actor, file);
  return file;
}
