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
runInNewContext(`(function(require, module, exports) { ${compiled} })`)(
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

const { renderSocialPhoto, parsePhotoOptions } = module.exports;

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
