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
