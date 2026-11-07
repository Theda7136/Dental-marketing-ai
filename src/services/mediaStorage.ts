import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
function key(id: string, kind: "image" | "video"): string { return `posts/${id}.${kind === "video" ? "mp4" : "png"}`; }
function localPath(id: string, kind: "image" | "video"): string { return path.join(process.cwd(), "storage", "posts", `${id}.${kind === "video" ? "mp4" : "png"}`); }
export async function storePostMedia(id: string, kind: "image" | "video", bytes: Uint8Array): Promise<void> {
  const cfg = config();
  if (cfg) { await cfg.client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key(id, kind), Body: bytes, ContentType: kind === "video" ? "video/mp4" : "image/png" })); return; }
  const file = localPath(id, kind); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
}
export async function readPostMedia(id: string, kind: "image" | "video"): Promise<Uint8Array> {
  const cfg = config();
  if (cfg) { const result = await cfg.client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key(id, kind) })); if (!result.Body) throw new Error("Archivo multimedia ausente."); return new Uint8Array(await result.Body.transformToByteArray()); }
  return new Uint8Array(await readFile(localPath(id, kind)));
}
export async function deletePostMedia(id: string, kind: "image" | "video"): Promise<void> {
  const cfg = config();
  if (cfg) { const { DeleteObjectCommand } = await import("@aws-sdk/client-s3"); await cfg.client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key(id, kind) })); return; }
  await rm(localPath(id, kind), { force: true });
}
