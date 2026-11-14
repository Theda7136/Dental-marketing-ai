import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const aiSource = readFileSync(new URL("../src/services/aiProvider.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../src/app/api/video-ads/scripts/route.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");

test("video ad Gemini service and route transpile without syntax errors", () => {
  for (const [fileName, source] of [["aiProvider.ts", aiSource], ["route.ts", routeSource]]) {
    const compiled = ts.transpileModule(source, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    assert.deepEqual(compiled.diagnostics ?? [], []);
  }
});

test("AI drafts require three distinct tones, safe copy and a caption for every scene", () => {
  assert.match(aiSource, /"educativa", "emocional", "comercial"/);
  assert.match(aiSource, /value\.scenes\.length !== sceneCount/);
  assert.match(aiSource, /clinicalGuardrails\.validate\(text as string\)/);
  assert.match(aiSource, /clinicalGuardrails\.validate\(value\[field\] as string\)/);
  assert.match(aiSource, /const answer = await queryGemini/);
  assert.match(aiSource, /Solo usa estos datos, no recibirás imágenes ni archivos de pacientes/);
});

test("AI script endpoint is permission protected and does not publish or upload media", () => {
  assert.match(proxySource, /pathname === "\/api\/video-ads\/scripts"/);
  assert.match(routeSource, /getStudioAccess\("content:write"\)/);
  assert.match(routeSource, /generateVideoAdDrafts/);
  assert.match(routeSource, /private, no-store/);
  assert.doesNotMatch(routeSource, /publishSelectedNetworks|publishToMeta|publishToTikTok|request\.formData/);
});
