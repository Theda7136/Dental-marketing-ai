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

test("storyboard stays local and makes no false video export claims", () => {
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /Descargar guion de producción/);
  assert.match(source, /no se suben archivos ni se genera MP4/);
  assert.doesNotMatch(source, /fetch\(|publishSelectedNetworks|create-post/);
});
