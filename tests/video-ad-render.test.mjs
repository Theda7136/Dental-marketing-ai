import { loadTs } from "./helpers/load-ts.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const rendererSource = readFileSync(new URL("../src/services/videoAdRenderer.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../src/app/api/video-ads/render/route.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");

test("rendering implementation and API route transpile without syntax errors", () => {
  for (const [fileName, source] of [["videoAdRenderer.ts", rendererSource], ["route.ts", routeSource]]) {
    const output = ts.transpileModule(source, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    assert.deepEqual(output.diagnostics ?? [], []);
  }
});

test("video rendering rejects oversized and excessively long storyboards", () => {
  const renderer = loadTs(new URL("../src/services/videoAdRenderer.ts", import.meta.url));
  const scene = { filename: "foto.png", bytes: Buffer.from([1]), kind: "image", seconds: 15, heading: "Valoración profesional" };
  assert.doesNotThrow(() => renderer.validateAdScenes([scene]));
  assert.throws(() => renderer.validateAdScenes([{ ...scene, seconds: 61 }]), /duración/);
  assert.throws(() => renderer.validateAdScenes(Array.from({ length: 13 }, () => scene)), /12 escenas/);
  assert.throws(() => renderer.validateAdScenes([{ ...scene, heading: "a".repeat(181) }]), /demasiado largo/);
});

test("clinical sources are fitted without crop, blur or zoom", () => {
  assert.doesNotMatch(rendererSource, /zoompan|boxblur|fit: "cover"|position: "attention"/);
  assert.match(rendererSource, /fit: "inside"/);
  assert.match(rendererSource, /force_original_aspect_ratio=decrease/);
});

test("advertising narrative includes a branded opening and closing CTA", () => {
  assert.match(rendererSource, /composeAdOverlay/);
  assert.match(rendererSource, /isClosing/);
  assert.match(rendererSource, /Message us on WhatsApp/);
  assert.match(routeSource, /style !== "premium"/);
  assert.match(routeSource, /style !== "dinamico"/);
  assert.match(routeSource, /style !== "educativo"/);
});

test("rendering endpoint requires clinic write access and never publishes", () => {
  assert.match(proxySource, /pathname === "\/api\/video-ads\/render"/);
  assert.match(routeSource, /getStudioAccess\("content:write"\)/);
  assert.match(routeSource, /clinicalGuardrails\.validate/);
  assert.match(routeSource, /Cache-Control": "private, no-store"/);
  assert.doesNotMatch(routeSource, /publishToMeta|publishToTikTok|publishSelectedNetworks/);
});


test("captions use measured glyphs, at most two lines, without shrinking or losing words", async () => {
  const { layoutAdCaption } = loadTs(new URL("../src/services/videoAdLayout.ts", import.meta.url));
  for (const font of ["arial", "georgia", "verdana", "trebuchet"]) {
    const text = "See each tooth in this digital model.";
    const layout = await layoutAdCaption(text, font);
    assert.equal(layout.fontSize, 68);
    assert.ok(layout.lines.length <= 2);
    assert.equal(layout.lines.join(" "), text);
    assert.ok(layout.images.every(line => line.info.width <= 936));
  }
  await assert.rejects(layoutAdCaption("A very long caption with many details that cannot fit into two large lines without reducing its size or omitting important words."), /dos líneas/);
});

test("clinical image and captions never overlap for landscape, portrait and square media", () => {
  const { clinicalLayout } = loadTs(new URL("../src/services/videoAdLayout.ts", import.meta.url));
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1000, 1000], [4000, 1000], [500, 4000]]) {
    const box = clinicalLayout(w, h);
    assert.ok(box.left >= 0 && box.left + box.width <= 1080);
    assert.ok(box.top + box.height <= 1560);
    assert.ok(Math.abs(box.width / box.height - w / h) < 0.02);
    assert.ok(box.captionTop + 176 <= box.top || box.captionTop >= box.top + box.height);
  }
});

test("WhatsApp closing has one invitation and no simulated button, footer or duplicate CTA", async () => {
  const { validateClosingCopy, composeAdOverlay } = loadTs(new URL("../src/services/videoAdLayout.ts", import.meta.url));
  assert.throws(() => validateClosingCopy("Message us on WhatsApp. Message us on WhatsApp."), /una sola vez/);
  assert.throws(() => validateClosingCopy("Book a consultation."), /WhatsApp/);
  const png = await composeAdOverlay("Message us on WhatsApp.", { clinicName: "Dental Studio", logoDataUrl: null }, "arial", 980, true);
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  // The old button region is uninterrupted canvas, not a hidden white rectangle.
  for (let y = 1385; y < 1520; y += 10) for (let x = 80; x < 1000; x += 10) {
    const i = (y * info.width + x) * info.channels;
    assert.deepEqual([...data.subarray(i, i + 3)], [245, 243, 238]);
  }
});

test("a dark transparent logo has a large visible footprint on both layouts", async () => {
  const { logoLayer } = loadTs(new URL("../src/services/videoAdLayout.ts", import.meta.url));
  const sharp = (await import("sharp")).default;
  const png = await sharp(Buffer.from('<svg width="300" height="100"><rect x="10" y="10" width="280" height="80" fill="#102e29"/></svg>')).png().toBuffer();
  for (const closing of [false, true]) {
    const [layer] = await logoLayer("data:image/png;base64," + png.toString("base64"), closing);
    const size = await sharp(layer.input).metadata();
    assert.ok(size.width >= (closing ? 500 : 300));
    assert.ok(size.height >= 80);
  }
});
