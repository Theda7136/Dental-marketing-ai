import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(new URL("../src/services/videoAdRenderer.ts", import.meta.url));
const sharp = require("sharp");
const rendererSource = require("node:fs").readFileSync(
  new URL("../src/services/videoAdRenderer.ts", import.meta.url), "utf8",
);
const script = ts.transpileModule(rendererSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;

const rendererModule = { exports: {} };
new Function("require", "module", "exports", script)(require, rendererModule, rendererModule.exports);
const { renderVideoAd } = rendererModule.exports;

test("FFmpeg renders an actual branded vertical MP4 from one real PNG", { timeout: 180_000 }, async () => {
  const png = await sharp({
    create: { width: 320, height: 240, channels: 3, background: "#d2ebe2" },
  }).png().toBuffer();

  const mp4 = await renderVideoAd([{
    filename: "test.png",
    bytes: png,
    kind: "image",
    seconds: 1,
    heading: "Conoce nuestra clínica",
  }], {
    clinicName: "Clinica piloto",
    primaryColor: "#116D60",
    logoDataUrl: null,
  });

  assert.ok(mp4.length > 1_000);
  assert.equal(mp4.toString("ascii", 4, 8), "ftyp");
});
