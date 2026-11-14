import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/VideoAdStudio.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/dashboard/video-ads/page.tsx", import.meta.url), "utf8");

test("the video ad editor and route contain no TypeScript syntax diagnostics", () => {
  for (const [name, content] of [["VideoAdStudio.tsx", source], ["page.tsx", route]]) {
    const output = ts.transpileModule(content, {
      fileName: name,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    });
    assert.deepEqual(output.diagnostics ?? [], []);
  }
});

test("video ads have separate navigation and are covered by write permissions", () => {
  assert.match(route, /view="video-ads"/);
  assert.match(dashboard, /href: "\/dashboard\/video-ads"/);
  assert.match(dashboard, /<VideoAdStudio\s*\/>/);
  assert.match(proxy, /pathname === "\/dashboard\/video-ads"/);
  assert.match(dashboard, /destination\.id === "video-ads".*currentRole !== "REVIEWER"/);
});

test("rendered MP4 is previewed and downloaded without automatic publishing", () => {
  assert.match(source, /\/api\/video-ads\/render/);
  assert.match(source, /Descargar video MP4/);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /no se guarda ni publica automáticamente/);
  assert.doesNotMatch(source, /publishSelectedNetworks|create-post/);
});

test("AI drafts are editable and rendering remains a separate explicit action", () => {
  assert.match(source, /\/api\/video-ads\/scripts/);
  assert.match(source, /Generar 3 guiones con IA/);
  assert.match(source, /setCopy\(\{ introduction: variant\.opening/);
  assert.match(source, /setScenes\(assets\.map/);
  assert.match(source, /\/api\/video-ads\/render/);
  assert.doesNotMatch(source, /publishSelectedNetworks|create-post/);
});
