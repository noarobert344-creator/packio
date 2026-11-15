import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/server/env";

/**
 * Stockage privé des fichiers. Aucun fichier n'est servi publiquement : les
 * téléchargements passent par /api/files/[id], qui vérifie les droits.
 * - local : disque (développement / auto-hébergement avec volume persistant)
 * - s3    : tout stockage compatible S3 (AWS, Cloudflare R2, Scaleway, OVH…)
 */
export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** URL signée de courte durée (S3) — null si le driver sert lui-même le fichier. */
  signedUrl(key: string, filename: string, contentType: string, ttlSeconds: number): Promise<string | null>;
}

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Clé de stockage invalide");
  return key;
}

class LocalDriver implements StorageDriver {
  private root = path.resolve(env.localStorageDir);
  private resolve(key: string) {
    const full = path.resolve(this.root, safeKey(key));
    if (!full.startsWith(this.root + path.sep)) throw new Error("Chemin hors du stockage");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
  async signedUrl() {
    return null;
  }
}

class S3Driver implements StorageDriver {
  private async client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region: env.s3.region,
      endpoint: env.s3.endpoint || undefined,
      forcePathStyle: !!env.s3.endpoint,
      credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.client()).send(
      new PutObjectCommand({ Bucket: env.s3.bucket, Key: safeKey(key), Body: data, ContentType: contentType, ServerSideEncryption: env.s3.endpoint ? undefined : "AES256" }),
    );
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const res = await (await this.client()).send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: safeKey(key) }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.client()).send(new DeleteObjectCommand({ Bucket: env.s3.bucket, Key: safeKey(key) }));
  }
  async signedUrl(key: string, filename: string, contentType: string, ttlSeconds: number) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      await this.client(),
      new GetObjectCommand({
        Bucket: env.s3.bucket,
        Key: safeKey(key),
        ResponseContentType: contentType,
        ResponseContentDisposition: `inline; filename="${filename.replace(/[^\w.\- ]/g, "_")}"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (!driver) {
    if (env.storageDriver === "s3") driver = new S3Driver();
    else {
      if (env.isProduction && process.env.ALLOW_LOCAL_STORAGE !== "1") {
        console.warn("[storage] Stockage local en production : configurez STORAGE_DRIVER=s3 (les disques serverless ne sont pas persistants).");
      }
      driver = new LocalDriver();
    }
  }
  return driver;
}

export function setStorageDriverForTests(d: StorageDriver | null) {
  driver = d;
}
