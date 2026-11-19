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

  const draft = {
    opening: "¿Quieres conocer el diseño de sonrisa?",
    message: "Conoce las opciones con orientación profesional.",
    closing: "Solicita información sobre tu valoración.",
    scenes: examples,
  };
  assert.throws(() => normalizeVideoAdCopy(draft), /instrucciones de producción/);
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
      narration: ["Cada consulta empieza por entender tus preguntas sobre las opciones.", "La valoración individual permite conversar sobre tus expectativas y prioridades."],
      title: "Diente a diente", opening: "Mira la forma de cada diente.", message: "Del modelo a tus preguntas.",
      closing: "Hablemos por WhatsApp.", scenes: ["Mira cada diente en este modelo digital.", "Y su forma en este modelo físico."],
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
      assert.match(request.systemInstruction.parts[0].text, /HUMANIZE DENTAL/);
      return modelResponse(valid);
    });
    assert.deepEqual(await generateVideoAdDrafts({ ...input, language }), valid.variants);
    assert.equal(calls, 2);
    mock.mock.restore();
  }
});

test("visual wording is editorial while clinical claims and extra CTAs stay blocked", () => {
  const { validateVisualNarrative, validateCommercialText } = loadTs(new URL("../src/services/videoAdCopy.ts", import.meta.url));
  assert.doesNotThrow(() => validateVisualNarrative(["Each tooth in a digital model."], ["Sonrisa de una persona"]));
  assert.doesNotThrow(() => validateVisualNarrative(["Explore your options on screen."], ["Modelo dental en pantalla"]));
  assert.throws(() => validateVisualNarrative(["Book your dental consultation."], ["Modelo dental"]), /cierre/);
  assert.doesNotThrow(() => validateVisualNarrative(["See each tooth in this digital model.", "See those shapes in a physical model."], input.visualDescriptions));
  for (const text of ["You have cavities.", "Tienes caries.", "This restores your smile.", "Corrige tu mordida.", "Board-certified dentist."]) {
    assert.throws(() => validateCommercialText(text), /no verificadas/);
  }
});
function completeDraft() {
  return { variants: [{ tone: "comercial", narration: ["Your questions about restoration options deserve time in a consultation.", "Discuss your priorities and expectations with a professional before deciding."], title: "A closer look", opening: "Look at each tooth.", message: "Bring your questions.", closing: "Message us on WhatsApp.", scenes: ["See each tooth in this digital model.", "See those shapes in a physical model."] }] };
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
    { variants: [{ ...completeDraft().variants[0], scenes: ["See each tooth in this digital model."] }] },
    { variants: [{ ...completeDraft().variants[0], scenes: ["See each tooth in this digital model.", ""] }] },
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
    assert.equal(requests.length, 3);
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
  assert.equal(calls, 4);
});

test("one commercial variant requires exactly one nonempty caption per file", () => {
  const { validateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  for (const count of [1, 2, 12]) {
    const draft = completeDraft();
    draft.variants[0].scenes = Array.from({ length: count }, (_, i) => `Bring question number ${i + 1} to your consultation.`);
    draft.variants[0].narration = draft.variants[0].scenes.map(text => `Consider this question in detail: ${text}`);
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
  assert.equal(calls, 4);
});

test("Humanize Dental automatically returns the edited draft, not the first response", async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const edited = completeDraft();
  edited.variants[0].scenes = ["See each tooth in this digital model.", "Those shapes in a physical model."];
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return modelResponse(requests.length === 1 ? completeDraft() : edited);
  });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  assert.deepEqual(await generateVideoAdDrafts(input), edited.variants);
  assert.equal(requests.length, 2);
  const edit = requests[1];
  assert.match(edit.systemInstruction.parts[0].text, /HUMANIZE DENTAL/);
  assert.match(edit.systemInstruction.parts[0].text, /español colombiano/);
  assert.match(edit.systemInstruction.parts[0].text, /inglés estadounidense/);
  assert.match(edit.contents[0].parts[0].text, /Modelo físico dental/);
  assert.match(edit.contents[0].parts[0].text, /borrador validado/);
  assert.doesNotMatch(JSON.stringify(requests), /speechConfig|elevenlabs/);
});

test("Humanize Dental repairs unsafe edits and never falls back silently to the raw draft", async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  for (const repairSucceeds of [true, false]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async (_url, options) => {
      calls++;
      const bad = completeDraft();
      bad.variants[0].scenes[0] = "Guaranteed results from this digital model.";
      if (calls === 3) {
        const body = JSON.parse(options.body);
        assert.match(body.systemInstruction.parts[0].text, /HUMANIZE DENTAL/);
        assert.match(body.contents[0].parts[0].text, /no verificadas/);
      }
      return modelResponse(calls === 1 || (calls === 3 && repairSucceeds) ? completeDraft() : bad);
    });
    if (repairSucceeds) assert.deepEqual(await generateVideoAdDrafts(input), completeDraft().variants);
    else await assert.rejects(generateVideoAdDrafts(input), /Humanize Dental no pudo completar/);
    assert.equal(calls, 3);
    mock.mock.restore();
  }
});

test("Humanize Dental rejects missing scenes, oversized captions and duplicated CTAs", async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  for (const mutate of [
    d => d.variants[0].scenes.pop(),
    d => d.variants[0].scenes[0] = "See every tooth and every outline in this digital model as we take a much closer look together.",
    d => d.variants[0].closing = "Message us on WhatsApp. Book now.",
  ]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      const draft = completeDraft();
      if (calls > 1) mutate(draft);
      return modelResponse(draft);
    });
    await assert.rejects(generateVideoAdDrafts(input), /Humanize Dental no pudo completar/);
    assert.equal(calls, 3);
    mock.mock.restore();
  }
});

test("literal and paraphrased repetitions are rejected without merging distinct evidence", () => {
  const { validateVisualNarrative } = loadTs(new URL("../src/services/videoAdCopy.ts", import.meta.url));
  for (const scenes of [
    ["Take a closer look at your restoration options.", "Explore your restoration choices."],
    ["Conoce tus opciones de restauración.", "Explora las alternativas de restauración."],
    ["Talk about the smile you want to achieve.", "Discuss the smile you desire."],
    ["Ask about options.", "A physical model shows shapes.", "Ask about options!"],
  ]) assert.throws(() => validateVisualNarrative(scenes, scenes.map(() => "Modelo dental")), /repiten/);
  assert.doesNotThrow(() => validateVisualNarrative(
    ["See each tooth in this digital model.", "See those shapes in a physical model."], input.visualDescriptions));
});

test("narration has its own word budget and clinical validation", () => {
  const { validateNarrationScript, narrationWordBudget } = loadTs(new URL("../src/services/videoAdCopy.ts", import.meta.url));
  assert.deepEqual(narrationWordBudget(30), { minimum: 44, maximum: 60 });
  const narration = [
    "When considering dental restoration options, a consultation gives you space to explain your priorities and ask what an individual assessment involves.",
    "The models shown provide a visual reference for that conversation. They do not establish which option is appropriate for you; discuss your questions with a professional.",
  ];
  assert.doesNotThrow(() => validateNarrationScript(narration, 2, "Message us on WhatsApp.", 30, "en-US"));
  for (const bad of [undefined, [], ["Short headline.", "Another headline."], [...narration, "Extra."]]) {
    assert.throws(() => validateNarrationScript(bad, 2, "Message us on WhatsApp.", 30, "en-US"));
  }
  assert.throws(() => validateNarrationScript([narration[0], "Guaranteed pain-free results."], 2, "Message us on WhatsApp.", 30, "en-US"), /no verificadas/);
});

test("Gemini repairs short or unsafe narration while retaining short captions", async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  for (const narration of [undefined, ["Short.", "Brief."], ["Guaranteed results.", "Ask questions."]]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      const draft = completeDraft();
      if (++calls === 1) draft.variants[0].narration = narration;
      return modelResponse(draft);
    });
    const [draft] = await generateVideoAdDrafts(input);
    assert.deepEqual(draft.narration, completeDraft().variants[0].narration);
    assert.notDeepEqual(draft.narration, draft.scenes);
    assert.equal(calls, 3);
    mock.mock.restore();
  }
});

test("production directions in the final scene are repaired without copying the closing CTA", async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    const draft = completeDraft();
    if (calls === 1) draft.variants[0].scenes[1] = "Call to action with WhatsApp icon.";
    if (calls === 2) {
      const correction = JSON.parse(options.body).contents[0].parts[0].text;
      assert.match(correction, /instrucciones de producción/);
      assert.doesNotMatch(correction, /Reserva la llamada/);
    }
    return modelResponse(draft);
  });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  const [draft] = await generateVideoAdDrafts(input);
  assert.deepEqual(draft.scenes, completeDraft().variants[0].scenes);
  assert.ok(draft.scenes.every(scene => scene !== draft.closing));
  assert.equal(calls, 3);
});

test("premature CTAs in narration and humanized captions trigger bounded repairs", async t => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  for (const invalidStage of [1, 2]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async (_url, options) => {
      calls++;
      const draft = completeDraft();
      if (calls === invalidStage) {
        if (invalidStage === 1) draft.variants[0].narration[0] = "Book your consultation today. " + draft.variants[0].narration[0];
        else draft.variants[0].scenes[1] = "Message us on WhatsApp.";
      }
      if (calls === invalidStage + 1) {
        const prompt = JSON.parse(options.body).contents[0].parts[0].text;
        assert.match(prompt, /llamada a la acción anticipada/);
      }
      return modelResponse(draft);
    });
    const drafts = await generateVideoAdDrafts(input);
    assert.deepEqual(drafts, completeDraft().variants);
    assert.equal(calls, invalidStage === 1 ? 3 : 4);
    mock.mock.restore();
  }
});
