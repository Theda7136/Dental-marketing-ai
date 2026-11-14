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
  const module = { exports: {} };
  const code = ts.transpileModule(rendererSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;

  runInNewContext(`(function(require, module, exports) { ${code} })`, { Buffer, URL, setTimeout, clearTimeout })(
    (specifier) => {
      if (specifier === "sharp" || specifier === "ffmpeg-static") return () => null;
      if (specifier.startsWith("node:")) return {};
      throw new Error(`Unexpected dependency ${specifier}`);
    },
    module,
    module.exports,
  );

  const scene = { filename: "foto.png", bytes: Buffer.from([1]), kind: "image", seconds: 15, heading: "Valoración profesional" };
  assert.doesNotThrow(() => module.exports.validateAdScenes([scene]));
  assert.throws(() => module.exports.validateAdScenes([{ ...scene, seconds: 46 }]), /duración/);
  assert.throws(() => module.exports.validateAdScenes(Array.from({ length: 13 }, () => scene)), /12 escenas/);
  assert.throws(() => module.exports.validateAdScenes([{ ...scene, heading: "a".repeat(181) }]), /demasiado largo/);
});

test("photo composition uses a full-frame blurred backdrop and safe foreground", () => {
  assert.match(rendererSource, /function photoMotionFilter\(index: number, style: VideoAdStyle/);
  assert.match(rendererSource, /zoompan=z=/);
  assert.match(rendererSource, /preparePhotoScene\(scene\.bytes\)/);
  assert.match(rendererSource, /\.blur\(38\)/);
  assert.match(rendererSource, /fit: "inside"/);
  assert.match(rendererSource, /sceneFilter\(scene\.kind, scene\.seconds, index, style\)/);
});

test("advertising narrative includes a branded opening and closing CTA", () => {
  assert.match(rendererSource, /TU SONRISA, NUESTRA PRIORIDAD/);
  assert.match(rendererSource, /SIGUIENTE PASO/);
  assert.match(rendererSource, /Solicita tu valoración/);
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
