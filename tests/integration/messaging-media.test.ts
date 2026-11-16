import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { detectType, uploadFile } from "@/server/services/files";
import { sendMessage } from "@/server/services/messaging";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

const pad = (head: Buffer, size = 64) => Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 1)]);
const ftyp = (brand: string) => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, "ascii")]));
const WEBM = pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]));
const ZIP = pad(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0, 0, 0]));

describe("Messagerie : notes vocales, vidéos et fichiers", () => {
  beforeEach(resetDb);

  it("détection du type réel : audio, vidéo, documents bureautiques, archives, texte ; le reste est refusé", () => {
    expect(detectType(WEBM, "note-vocale-20261117.weba", "audio/webm")).toBe("audio/webm");
    expect(detectType(WEBM, "clip.webm", "video/webm")).toBe("video/webm");
    expect(detectType(ftyp("isom"), "video.mp4")).toBe("video/mp4");
    expect(detectType(ftyp("qt  "), "IMG_0001.MOV")).toBe("video/quicktime");
    expect(detectType(ftyp("M4A "), "note-vocale.m4a", "audio/mp4")).toBe("audio/mp4");
    expect(detectType(pad(Buffer.from("OggS")), "note.ogg")).toBe("audio/ogg");
    expect(detectType(pad(Buffer.from("ID3")), "son.mp3")).toBe("audio/mpeg");
    expect(detectType(ZIP, "facture.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(detectType(ZIP, "stock.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(detectType(ZIP, "photos.zip")).toBe("application/zip");
    expect(detectType(ZIP, "appli.apk")).toBeNull();
    expect(detectType(Buffer.from("Référence;Quantité\nSKU-1;2\n"), "inventaire.csv")).toBe("text/csv");
    expect(detectType(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff]), "notes.txt")).toBeNull();
    expect(detectType(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff]), "setup.exe")).toBeNull();
  });

  it("limites : vidéo jusqu'à 40 Mo, audio 15 Mo ; vidéos refusées hors messagerie ; note vocale annoncée comme telle", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin);
    const client = await createCustomer({ plan: "PRO" });
    await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });

    const video = await uploadFile(client.actor, { purpose: "MESSAGE_ATTACHMENT", filename: "colis.mp4", data: pad(ftyp("isom").subarray(0, 12), 12 * 1024 * 1024) });
    expect(video.mimeType).toBe("video/mp4");
    await expect(uploadFile(client.actor, { purpose: "PRODUCT_PHOTO", filename: "colis.mp4", data: ftyp("isom") })).rejects.toMatchObject({ code: "TYPE" });
    await expect(
      uploadFile(client.actor, { purpose: "MESSAGE_ATTACHMENT", filename: "note-vocale.weba", declaredType: "audio/webm", data: pad(WEBM.subarray(0, 12), 16 * 1024 * 1024) }),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });

    const voice = await uploadFile(client.actor, { purpose: "MESSAGE_ATTACHMENT", filename: "note-vocale-1.weba", declaredType: "audio/webm", data: WEBM });
    expect(voice.mimeType).toBe("audio/webm");
    const conversation = await db.conversation.findFirstOrThrow({ where: { customerId: client.customerId, type: "CUSTOMER_PREPARER" } });
    await sendMessage(client.actor, { conversationId: conversation.id, body: "", attachmentIds: [voice.id] });
    const notification = await db.notification.findFirstOrThrow({ where: { userId: prep.actor.userId, type: "NEW_MESSAGE" } });
    expect(notification.body).toBe("Note vocale");
  });
});
