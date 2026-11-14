import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(
  readFileSync(new URL("../src/services/imageService.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const module = { exports: {} };
runInNewContext(`(function(require, module, exports) { ${compiled} })`, { Buffer, Uint8Array })(
  (name) => {
    if (name === "sharp") return { __esModule: true, default: sharp };
    if (name === "../config/clinicalGuardrails") {
      return { clinicalGuardrails: { allowedDentalTerms: ["Ortodoncia"] } };
    }
    throw new Error(`Unexpected dependency: ${name}`);
  },
  module,
  module.exports,
);

const { renderSocialPhoto, renderStoryPhoto, overlayOnClinicTemplate, parsePhotoOptions } = module.exports;

async function fixture(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: "#b75a43" },
  }).png().toBuffer();
}

test("narrow dental portrait becomes full 1080x1350 without dark bars", async () => {
  const frame = await renderSocialPhoto(await fixture(400, 1000), parsePhotoOptions({
    layout: "AUTO", background: "LIGHT", preset: "CLINICAL",
  }));
  const metadata = await sharp(frame).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  const pixel = await sharp(frame).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(pixel[0] > 200 && pixel[1] > 200 && pixel[2] > 200);
});

test("blurred background and intentional cover preserve export dimensions", async () => {
  const frame = await renderSocialPhoto(await fixture(640, 960), parsePhotoOptions({
    layout: "COVER", background: "BLUR", preset: "COMMERCIAL",
    zoom: 1.15, offsetX: 20, offsetY: -20,
  }));
  const metadata = await sharp(frame).metadata();
  assert.deepEqual([metadata.width, metadata.height], [1080, 1350]);
});

test("out of range zoom is rejected", () => {
  assert.throws(() => parsePhotoOptions({ zoom: 9 }), /Opciones de encuadre/);
});


test("Story composition preserves both edges of the original in 1080x1920", async () => {
  const original = await sharp({
    create: { width: 720, height: 1280, channels: 3, background: "#b75a43" },
  }).composite([
    { input: { create: { width: 720, height: 32, channels: 3, background: "#1428e6" } }, left: 0, top: 0 },
    { input: { create: { width: 720, height: 32, channels: 3, background: "#11b45a" } }, left: 0, top: 1248 },
  ]).png().toBuffer();

  const story = await renderStoryPhoto({
    cleanImage: original,
    procedureName: "Ortodoncia",
    brand: { clinicName: "Consultorio Dental", primaryColor: "#116D60", fontFamily: "SANS", logoDataUrl: null },
  });
  const metadata = await sharp(story).metadata();
  const top = await sharp(story).extract({ left: 540, top: 10, width: 1, height: 1 }).raw().toBuffer();
  const bottom = await sharp(story).extract({ left: 540, top: 1790, width: 1, height: 1 }).raw().toBuffer();
  const footer = await sharp(story).extract({ left: 540, top: 1900, width: 1, height: 1 }).raw().toBuffer();
  const margin = await sharp(story).extract({ left: 5, top: 900, width: 1, height: 1 }).raw().toBuffer();

  assert.deepEqual([metadata.width, metadata.height, metadata.format], [1080, 1920, "png"]);
  assert.ok(top[2] > top[0], "the original top edge must be preserved");
  assert.ok(bottom[1] > bottom[0], "the original bottom edge must be preserved");
  assert.ok(footer[1] > footer[0], "the clinical photo reaches the bottom of the story");
  assert.ok(margin[0] > 100 && margin[0] < 220, "the original image fills the story without a footer");
});


test("automatic framing preserves the top and bottom of a clinical portrait", async () => {
  const source = await sharp({
    create: { width: 760, height: 1000, channels: 3, background: "#b75a43" },
  }).composite([
    { input: { create: { width: 760, height: 30, channels: 3, background: "#1428e6" } }, left: 0, top: 0 },
    { input: { create: { width: 760, height: 30, channels: 3, background: "#11b45a" } }, left: 0, top: 970 },
  ]).png().toBuffer();
  const frame = await renderSocialPhoto(source);
  const top = await sharp(frame).extract({ left: 540, top: 10, width: 1, height: 1 }).raw().toBuffer();
  const bottom = await sharp(frame).extract({ left: 540, top: 1330, width: 1, height: 1 }).raw().toBuffer();

  assert.ok(top[2] > top[0], "the upper clinical edge must be visible");
  assert.ok(bottom[1] > bottom[0], "the lower clinical edge must be visible");
});

test("a clinic logo is embedded in the bottom-right corner without a footer", async () => {
  const logo = await sharp({
    create: { width: 80, height: 80, channels: 4, background: "#ff0000" },
  }).png().toBuffer();
  const branded = await overlayOnClinicTemplate({
    cleanImage: await fixture(1080, 1350),
    procedureName: "Ortodoncia",
    brand: {
      clinicName: "Consultorio Dental",
      primaryColor: "#116D60",
      fontFamily: "SANS",
      logoDataUrl: `data:image/png;base64,${logo.toString("base64")}`,
    },
  });

  const metadata = await sharp(branded).metadata();
  const logoPixel = await sharp(branded)
    .extract({ left: 1000, top: 1250, width: 1, height: 1 }).raw().toBuffer();
  const photoPixel = await sharp(branded)
    .extract({ left: 540, top: 1300, width: 1, height: 1 }).raw().toBuffer();

  assert.deepEqual([metadata.width, metadata.height], [1080, 1350]);
  assert.ok(logoPixel[0] > 200 && logoPixel[1] < 50, "logo is visible inside the photo");
  assert.ok(photoPixel[0] < 220, "no footer replaces the clinical image");
});

test("story watermark stays above the bottom controls", async () => {
  const logo = await sharp({
    create: { width: 80, height: 80, channels: 4, background: "#ff0000" },
  }).png().toBuffer();
  const branded = await renderStoryPhoto({
    cleanImage: await fixture(1080, 1920),
    procedureName: "Ortodoncia",
    brand: {
      clinicName: "Consultorio Dental",
      primaryColor: "#116D60",
      fontFamily: "SANS",
      logoDataUrl: `data:image/png;base64,${logo.toString("base64")}`,
    },
  });
  const logoPixel = await sharp(branded)
    .extract({ left: 1000, top: 1650, width: 1, height: 1 }).raw().toBuffer();
  const footerPixel = await sharp(branded)
    .extract({ left: 1000, top: 1850, width: 1, height: 1 }).raw().toBuffer();

  assert.ok(logoPixel[0] > 200 && logoPixel[1] < 50, "story logo stays clear of UI");
  assert.ok(footerPixel[1] > 50, "the original story reaches the bottom");
});
