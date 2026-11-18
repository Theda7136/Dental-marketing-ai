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

test("AI drafts require one commercial variant, safe copy and a caption for every file", () => {
  assert.match(aiSource, /const tones: VideoAdTone\[\] = \["comercial"\]/);
  assert.match(aiSource, /value\.scenes\.length !== sceneCount/);
  assert.match(aiSource, /cleanCopy\.scenes\.forEach\(text => clinicalGuardrails\.validate\(text\)\)/);
  assert.match(aiSource, /clinicalGuardrails\.validate\(value\[field\] as string\)/);
  assert.match(aiSource, /answer = await queryGemini/);
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

import { loadTs } from "./helpers/load-ts.mjs";
const input = { procedure: "Diseño de sonrisa", goal: "whatsapp", duration: 15, sceneCount: 2, clinicContext: "", language: "en-US", visualDescriptions: ["Modelo digital de dientes", "Modelo físico dental"] };
test("reported generic captions are repaired in both locales using the original observations", async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  for (const language of ["en-US", "es-CO"]) {
    const valid = completeDraft();
    if (language === "es-CO") Object.assign(valid.variants[0], {
      title: "Diente a diente", opening: "Mira la forma de cada diente.", message: "Del modelo a tus preguntas.",
      closing: "Hablemos por WhatsApp.", scenes: ["Cada diente en el modelo digital.", "Su forma en el modelo físico."],
    });
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async (_url, options) => {
      calls++;
      const request = JSON.parse(options.body);
      if (calls === 1) {
        const bad = structuredClone(valid);
        bad.variants[0].scenes = language === "en-US"
          ? ["Exploring digital shapes together", "Reviewing your personalized options"]
          : ["Explorando formas digitales juntos", "Revisando tus opciones personalizadas"];
        return modelResponse(bad);
      }
      assert.match(request.contents[0].parts[0].text, /Modelo físico dental/);
      assert.match(request.contents[0].parts[0].text, /genéricas/);
      return modelResponse(valid);
    });
    assert.deepEqual(await generateVideoAdDrafts({ ...input, language }), valid.variants);
    assert.equal(calls, 2);
    mock.mock.restore();
  }
});

test("visual anchors cannot be invented or replaced by an abstract tool benefit", () => {
  const { validateVisualNarrative, validateCommercialText } = loadTs(new URL("../src/services/videoAdCopy.ts", import.meta.url));
  assert.throws(() => validateVisualNarrative(["Each tooth in a digital model."], ["Sonrisa de una persona"]), /no respaldado/);
  assert.throws(() => validateVisualNarrative(["Explore your options on screen."], ["Modelo dental en pantalla"]), /detalle visual/);
  assert.throws(() => validateVisualNarrative(["Book your dental consultation."], ["Modelo dental"]), /cierre/);
  assert.doesNotThrow(() => validateVisualNarrative(["Each tooth in this digital model.", "Those shapes in a physical model."], input.visualDescriptions));
  for (const text of ["You have cavities.", "Tienes caries.", "This restores your smile.", "Corrige tu mordida.", "Board-certified dentist."]) {
    assert.throws(() => validateCommercialText(text), /no verificadas/);
  }
});
function completeDraft() {
  return { variants: [{ tone: "comercial", title: "A closer look", opening: "Look at each tooth.", message: "Bring your questions.", closing: "Message us on WhatsApp.", scenes: ["Each tooth in this digital model.", "Those shapes in a physical model."] }] };
}
function modelResponse(text) {
  return Response.json({ candidates: [{ content: { parts: [{ text: typeof text === "string" ? text : JSON.stringify(text) }] } }] });
}

test("missing, empty, extra and malformed scenes are automatically repaired from original observations", async t => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  const invalid = [
    { variants: [{ ...completeDraft().variants[0], scenes: ["Each tooth in this digital model."] }] },
    { variants: [{ ...completeDraft().variants[0], scenes: ["Each tooth in this digital model.", ""] }] },
    { variants: [{ ...completeDraft().variants[0], scenes: [...completeDraft().variants[0].scenes, "An extra scene."] }] },
    { variants: [{ ...completeDraft().variants[0], scenes: null }] },
    '{"variants":[',
    "",
  ];
  for (const bad of invalid) {
    const requests = [];
    const mock = t.mock.method(globalThis, "fetch", async (url, options) => {
      assert.match(url, /generativelanguage.googleapis.com/);
      requests.push(JSON.parse(options.body));
      return modelResponse(requests.length === 1 ? bad : completeDraft());
    });
    const result = await generateVideoAdDrafts(input);
    assert.deepEqual(result, completeDraft().variants);
    assert.equal(requests.length, 2);
    const repair = requests[1].contents[0].parts[0].text;
    assert.match(repair, /EXACTAMENTE UNA/);
    assert.match(repair, /scenes\[0\]/);
    assert.match(repair, /scenes\[1\]/);
    assert.match(repair, /Modelo físico dental/);
    assert.match(repair, /NO evidencia clínica/);
    assert.match(repair, /sin inventar detalles/);
    mock.mock.restore();
  }
});

test("repair is bounded and never returns invented filler after repeated incomplete responses", async t => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return modelResponse({ variants: [{ ...completeDraft().variants[0], scenes: [] }] });
  });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  await assert.rejects(generateVideoAdDrafts(input), /escenas incompletas/);
  assert.equal(calls, 3);
});

test("a repaired response with unsupported clinical claims must be repaired again", async t => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    const draft = completeDraft();
    if (calls === 1) draft.variants[0].scenes.pop();
    if (calls === 2) draft.variants[0].scenes[1] = "Guaranteed pain-free results with this physical model.";
    return modelResponse(draft);
  });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  assert.deepEqual(await generateVideoAdDrafts(input), completeDraft().variants);
  assert.equal(calls, 3);
});

test("one commercial variant requires exactly one nonempty caption per file", () => {
  const { validateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  for (const count of [1, 2, 12]) {
    const draft = completeDraft();
    draft.variants[0].scenes = Array.from({ length: count }, (_, i) => `Bring question number ${i + 1} to your consultation.`);
    assert.equal(validateVideoAdDrafts(draft, count, "en-US")[0].scenes.length, count);
  }
  const draft = completeDraft();
  assert.throws(() => validateVideoAdDrafts({ variants: [...draft.variants, ...draft.variants] }, 2), /variantes/);
  draft.variants[0].tone = "educativa";
  assert.throws(() => validateVideoAdDrafts(draft, 2));
});

test("ElevenLabs selection never changes the Gemini script pipeline or calls speech APIs", async t => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.match(url, /generativelanguage.googleapis.com/);
    assert.doesNotMatch(options.body, /speechConfig|responseModalities|elevenlabs/i);
    return modelResponse(completeDraft());
  });
  const { POST } = loadTs(new URL("../src/app/api/video-ads/scripts/route.ts", import.meta.url), {
    "@/lib/studioAccess": { getStudioAccess: async () => ({ clinic: { id: "test-clinic" } }) },
    "./grokService": {},
  });
  for (const narrationProvider of ["elevenlabs", "gemini"]) {
    const response = await POST(new Request("http://localhost/api/video-ads/scripts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, narrationProvider }) }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), completeDraft());
  }
  assert.equal(calls, 2);
});
