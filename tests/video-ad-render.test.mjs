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
  assert.match(rendererSource, /brand\.clinicName\.slice/);
  assert.match(rendererSource, /isClosing/);
  assert.match(rendererSource, /Book a consultation/);
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
