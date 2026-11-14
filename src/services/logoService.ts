import sharp from "sharp";

export async function prepareLogo(
  source: Buffer,
  width = 640,
  height = 240,
  allowUpscale = false,
): Promise<Buffer> {
  const cropped = await sharp(source, { failOn: "error", limitInputPixels: 8_000_000 })
    .rotate()
    .trim({ threshold: 18 })
    .png()
    .toBuffer();

  return sharp(cropped)
    .resize({ width, height, fit: "inside", withoutEnlargement: !allowUpscale })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function prepareWatermarkLogo(source: Buffer): Promise<Buffer> {
  const logo = await prepareLogo(source, 600, 240, true);
  const padding = 6;
  const padded = await sharp(logo)
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: "#00000000" })
    .png().toBuffer();
  const { width, height } = await sharp(padded).metadata();
  if (!width || !height) throw new Error("El logotipo no tiene dimensiones válidas.");

  const outlineAlpha = await sharp(padded)
    .extractChannel("alpha")
    .dilate(4)
    .linear(0.75, 0)
    .toBuffer();
  const outline = await sharp({
    create: { width, height, channels: 3, background: "#ffffff" },
  }).joinChannel(outlineAlpha).png().toBuffer();

  return sharp(outline)
    .composite([{ input: padded, top: 0, left: 0 }])
    .png().toBuffer();
}
