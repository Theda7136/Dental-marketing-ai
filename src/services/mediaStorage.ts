import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type MediaKind = "image" | "video";

function config() {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const hasStorageSetting = Boolean(bucket || accessKeyId || secretAccessKey || process.env.AWS_S3_ENDPOINT);
  if (!hasStorageSetting) return null;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("El almacenamiento S3 está incompleto. Configura bucket y credenciales, o elimina todas las variables S3 para usar disco local.");
  }
  const endpoint = process.env.AWS_S3_ENDPOINT;
  return { bucket, client: new S3Client({
    region: process.env.AWS_REGION || (endpoint ? "auto" : "us-east-1"),
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId, secretAccessKey },
  }) };
}

function safeSegment(segment: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(segment)) {
    throw new Error("Identificador de clínica o publicación no válido.");
  }
  return segment;
}

function mediaName(id: string, kind: MediaKind): string {
  return `${safeSegment(id)}.${kind === "video" ? "mp4" : "png"}`;
}

function storageKey(clinicId: string, id: string, kind: MediaKind): string {
  return `clinics/${safeSegment(clinicId)}/posts/${mediaName(id, kind)}`;
}

function localPath(clinicId: string, id: string, kind: MediaKind): string {
  return path.join(process.cwd(), "storage", storageKey(clinicId, id, kind));
}

function legacyKey(id: string, kind: MediaKind): string {
  return `posts/${mediaName(id, kind)}`;
}

function missingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { name?: string; Code?: string; code?: string };
  const code = failure.Code || failure.code;
  return failure.name === "NoSuchKey" || failure.name === "NotFound" ||
    code === "NoSuchKey" || code === "NotFound" || code === "ENOENT";
}

export async function storePostMedia(clinicId: string, id: string, kind: MediaKind, bytes: Uint8Array): Promise<void> {
  const key = storageKey(clinicId, id, kind);
  const cfg = config();
  if (cfg) {
    await cfg.client.send(new PutObjectCommand({
      Bucket: cfg.bucket, Key: key, Body: bytes,
      ContentType: kind === "video" ? "video/mp4" : "image/png",
    }));
    return;
  }
  const file = localPath(clinicId, id, kind);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

export async function readPostMedia(clinicId: string, id: string, kind: MediaKind): Promise<Uint8Array> {
  const key = storageKey(clinicId, id, kind);
  const cfg = config();
  if (cfg) {
    try {
      const object = await cfg.client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      if (!object.Body) throw new Error("Archivo multimedia ausente.");
      return new Uint8Array(await object.Body.transformToByteArray());
    } catch (error) {
      if (clinicId !== "pilot" || !missingObject(error)) throw error;
      const legacy = await cfg.client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: legacyKey(id, kind) }));
      if (!legacy.Body) throw new Error("Archivo multimedia ausente.");
      return new Uint8Array(await legacy.Body.transformToByteArray());
    }
  }

  try {
    return new Uint8Array(await readFile(localPath(clinicId, id, kind)));
  } catch (error) {
    if (clinicId !== "pilot" || !missingObject(error)) throw error;
    return new Uint8Array(await readFile(path.join(process.cwd(), "storage", legacyKey(id, kind))));
  }
}

export async function deletePostMedia(clinicId: string, id: string, kind: MediaKind): Promise<void> {
  const key = storageKey(clinicId, id, kind);
  const cfg = config();
  if (cfg) {
    await cfg.client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return;
  }
  await rm(localPath(clinicId, id, kind), { force: true });
}
