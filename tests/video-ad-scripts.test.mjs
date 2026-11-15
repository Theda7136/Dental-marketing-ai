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
  assert.match(aiSource, /cleanCopy\.scenes\.forEach\(text => clinicalGuardrails\.validate\(text\)\)/);
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

test("production directions are not accepted as ad captions", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const source = readFileSync(new URL("../src/services/videoAdCopy.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", compiled)(module, module.exports);
  const { looksLikeProductionInstruction, normalizeVideoAdCopy } = module.exports;

  const examples = [
    "Imagen de la fachada o recepción de la clínica dental.",
    "Profesional revisando una historia clínica con el paciente.",
    "Llamado a la acción con el ícono de WhatsApp visible.",
  ];
  examples.forEach(line => assert.equal(looksLikeProductionInstruction(line), true));
  assert.equal(looksLikeProductionInstruction("Solicita información sobre tu valoración."), false);

  const draft = normalizeVideoAdCopy({
    opening: "¿Quieres conocer el diseño de sonrisa?",
    message: "Conoce las opciones con orientación profesional.",
    closing: "Solicita información sobre tu valoración.",
    scenes: examples,
  });
  assert.deepEqual(draft.scenes, [draft.opening, draft.message, draft.closing]);
  assert.throws(() => normalizeVideoAdCopy({
    ...draft, opening: "Imagen de la fachada de la clínica",
  }), /instrucciones de producción/);
});
