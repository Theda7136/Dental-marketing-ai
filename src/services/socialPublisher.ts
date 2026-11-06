import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

/**
 * Sube la imagen procesada a S3/R2 para obtener una URL pública requerida por Meta API.
 */
async function uploadMediaToPublicUrl(base64Data: string, filename: string): Promise<string> {
  const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Image, "base64");

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `posts/${filename}.png`,
    Body: buffer,
    ContentType: "image/png",
  });

  await s3.send(command);
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/posts/${filename}.png`;
}

/**
 * Publica o programa la foto en la cuenta de Instagram de la clínica.
 */
export async function publishToInstagram(params: {
  mediaUrlBase64: string;
  caption: string;
  postId: string;
  scheduledPublishTime?: number; // Unix timestamp en segundos para programar
}): Promise<{ mediaId: string }> {
  const instagramAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!instagramAccountId || !accessToken) {
    throw new Error("Credenciales de Meta API no configuradas.");
  }

  // 1. Obtener URL pública de la foto
  const publicImageUrl = await uploadMediaToPublicUrl(params.mediaUrlBase64, params.postId);

  // 2. Crear el contenedor de contenido en Instagram (Container ID)
  const containerParams = new URLSearchParams({
    image_url: publicImageUrl,
    caption: params.caption,
    access_token: accessToken,
  });

  if (params.scheduledPublishTime) {
    containerParams.append("scheduled_publish_time", params.scheduledPublishTime.toString());
  }

  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${instagramAccountId}/media`,
    {
      method: "POST",
      body: containerParams,
    }
  );

  const containerData = await containerRes.json();
  if (!containerRes.ok || !containerData.id) {
    throw new Error(`Error en Meta Container: ${containerData.error?.message || "Desconocido"}`);
  }

  // Si fue programado a futuro, no requiere publicación inmediata
  if (params.scheduledPublishTime) {
    return { mediaId: containerData.id };
  }

  // 3. Publicar el contenedor en el feed de Instagram
  const publishParams = new URLSearchParams({
    creation_id: containerData.id,
    access_token: accessToken,
  });

  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`,
    {
      method: "POST",
      body: publishParams,
    }
  );

  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id) {
    throw new Error(`Error publicando en Instagram: ${publishData.error?.message || "Desconocido"}`);
  }

  return { mediaId: publishData.id };
}