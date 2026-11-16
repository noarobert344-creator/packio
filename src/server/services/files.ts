import { createHash, randomUUID } from "node:crypto";
import type { File as FileRow } from "@/generated/prisma/client";
import type { FilePurpose } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/auth/actor";
import { storage } from "@/server/storage";
import { getConversationAccess } from "./messaging";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Messagerie : vidéos jusqu'à 40 Mo, notes vocales et audio jusqu'à 15 Mo. */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"] as const;
const DOC_TYPES = ["application/pdf"] as const;
const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav"] as const;
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
const OFFICE_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "text/plain",
  "text/csv",
] as const;

/** Types affichés directement dans le navigateur ; les autres sont toujours téléchargés. */
export const INLINE_TYPES: readonly string[] = [...IMAGE_TYPES, ...DOC_TYPES, ...AUDIO_TYPES, ...VIDEO_TYPES];

export function maxBytesFor(mime: string) {
  if (mime.startsWith("video/")) return MAX_VIDEO_BYTES;
  if (mime.startsWith("audio/")) return MAX_AUDIO_BYTES;
  return MAX_UPLOAD_BYTES;
}

const ALLOWED_BY_PURPOSE: Record<FilePurpose, readonly string[]> = {
  AVATAR: ["image/jpeg", "image/png", "image/webp"],
  PRODUCT_PHOTO: IMAGE_TYPES,
  ORDER_PHOTO: IMAGE_TYPES,
  RECEPTION_PHOTO: IMAGE_TYPES,
  PREPARATION_PHOTO: IMAGE_TYPES,
  SHIPPING_LABEL: [...DOC_TYPES, ...IMAGE_TYPES],
  MESSAGE_ATTACHMENT: [...IMAGE_TYPES, ...DOC_TYPES, ...AUDIO_TYPES, ...VIDEO_TYPES, ...OFFICE_TYPES],
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
    if (["M4A ", "M4B "].includes(brand)) return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    if (["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V ", "3gp4", "3gp5", "3g2a", "MSNV"].includes(brand)) return "video/mp4";
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  if (buf.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buf.subarray(0, 3).toString("ascii") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "application/zip";
  if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "application/x-cfb";
  return null;
}

const ZIP_BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  zip: "application/zip",
};
const CFB_BY_EXT: Record<string, string> = { doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint" };

/** Texte brut : UTF-8 valide, sans octet nul (les 64 premiers Ko sont vérifiés). */
function isPlainText(buf: Buffer) {
  const head = buf.subarray(0, 65536);
  if (head.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.length === buf.length ? head : head.subarray(0, head.length - 4));
    return true;
  } catch {
    return false;
  }
}

/**
 * Type réel d'un fichier : signature binaire, précisée par l'extension pour
 * les conteneurs ambigus (ZIP bureautique, WebM audio ou vidéo, texte).
 */
export function detectType(buf: Buffer, filename: string, declaredType?: string | null): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const sniffed = sniffMime(buf);
  if (sniffed === "video/webm" && (declaredType?.startsWith("audio/") || ext === "weba" || filename.toLowerCase().startsWith("note-vocale"))) return "audio/webm";
  if (sniffed === "application/zip") return ZIP_BY_EXT[ext] ?? null;
  if (sniffed === "application/x-cfb") return CFB_BY_EXT[ext] ?? null;
  if (sniffed) return sniffed;
  if ((ext === "txt" || ext === "csv") && buf.length && isPlainText(buf)) return ext === "csv" ? "text/csv" : "text/plain";
  return null;
}

function cleanFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "fichier";
  return base.replace(/[^\p{L}\p{N}._\- ]/gu, "_").slice(0, 120) || "fichier";
}

const EXT: Record<string, string> = {
  "audio/webm": "weba",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export async function uploadFile(actor: Actor, input: { purpose: FilePurpose; filename: string; data: Buffer; customerId?: string | null; declaredType?: string | null }) {
  if (input.data.length === 0) throw new DomainError("EMPTY", "Fichier vide.");
  const mime = input.purpose === "MESSAGE_ATTACHMENT" ? detectType(input.data, input.filename, input.declaredType) : sniffMime(input.data);
  if (!mime || !ALLOWED_BY_PURPOSE[input.purpose].includes(mime)) {
    throw new DomainError(
      "TYPE",
      input.purpose === "MESSAGE_ATTACHMENT"
        ? "Format non autorisé. Formats acceptés : images, vidéos (MP4, MOV, WebM), audio, PDF, Word, Excel, PowerPoint, ZIP, texte."
        : "Format non autorisé. Formats acceptés : JPEG, PNG, WebP, HEIC" + (ALLOWED_BY_PURPOSE[input.purpose].includes("application/pdf") ? ", PDF." : "."),
    );
  }
  const max = input.purpose === "MESSAGE_ATTACHMENT" ? maxBytesFor(mime) : MAX_UPLOAD_BYTES;
  if (input.data.length > max) throw new DomainError("TOO_LARGE", `Fichier trop volumineux (${Math.round(max / 1024 / 1024)} Mo maximum).`);

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
