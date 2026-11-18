import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const timeline = loadTs(new URL("../src/services/videoAdTimeline.ts", import.meta.url));
const { validateCommercialText } = loadTs(new URL("../src/services/videoAdCopy.ts", import.meta.url));
function tone(seconds) {
  const pcm = Buffer.alloc(Math.round(seconds * 24000) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i * 2 * Math.PI * 220 / 24000)), i * 2);
  return pcm;
}

test("provider padding is trimmed while internal pauses and speech survive", () => {
  const speech = tone(0.4);
  const input = Buffer.concat([Buffer.alloc(48000), speech, Buffer.alloc(48000), speech, Buffer.alloc(48000)]);
  const result = timeline.compactNarration(input);
  assert.ok(result.pcm.length / 48000 > 1.8 && result.pcm.length / 48000 < 1.9);
  assert.ok(result.pcm.includes(speech));
  assert.ok(Math.abs(result.mapTime(2.4) - 1.43) < 0.02);
  const natural = Buffer.concat([speech, Buffer.alloc(4800), speech]);
  assert.deepEqual(timeline.compactNarration(natural).pcm, natural);
  assert.throws(() => timeline.compactNarration(Buffer.alloc(48000)), /silenciosa/);
  assert.throws(() => timeline.compactNarration(Buffer.alloc(3)), /inválida/);
});

test("scene boundaries use measured times and total duration only rounds up one frame", () => {
  const pcm = tone(3.21);
  const durations = timeline.narrationDurations({ pcm, starts: [0, 0.8, 2.1] }, 3);
  assert.ok(Math.abs(durations[0] - 0.8) <= 1 / 24);
  assert.ok(Math.abs(durations.reduce((a, b) => a + b) - 3.21) <= 1 / 24);
  for (const starts of [[0], [0, 0, 2], [0, 2, 1], [0, NaN, 2], [0, 1, 5]]) {
    assert.throws(() => timeline.narrationDurations({ pcm, starts }, 3));
  }
  assert.throws(() => timeline.narrationDurations({ pcm: tone(1), starts: [0, 0.999] }, 2), /última escena/);
  assert.throws(() => timeline.narrationDurations({ pcm: tone(60.1), starts: [0] }, 1), /60 segundos/);
});

test("Clinical claims and mixed CTAs are rejected; editorial wording is not blocked", () => {
  for (const text of ["Guaranteed results", "Pain-free dentistry", "Carillas de porcelana", "Certificados para darte resultados", "100% effective"]) {
    assert.throws(() => validateCommercialText(text));
  }
  assert.throws(() => validateCommercialText("Agenda tu valoración", "en-US"), /idiomas/);
  assert.throws(() => validateCommercialText("Book your consultation", "es-CO"), /idiomas/);
  assert.doesNotThrow(() => validateCommercialText("Each tooth in this digital model.", "en-US"));
  assert.doesNotThrow(() => validateCommercialText("En este modelo digital se ve la forma de cada diente.", "es-CO"));
});

test("Gemini synthesizes once for scenes plus CTA and validates audio-derived boundaries", async t => {
  const segments = ["Look at this digital model.", "Message us on WhatsApp."];
  let calls = 0;
  let received;
  process.env.GEMINI_API_KEY = "test-key";
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].inlineData.mimeType, "audio/wav");
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ segments: [
      { text: segments[0], start: 0, end: 1 }, { text: segments[1], start: 1.05, end: 2 },
    ] }) }] } }] });
  });
  const { generateVideoAdNarration } = loadTs(new URL("../src/services/videoAdNarration.ts", import.meta.url), {
    "./geminiNarration": { generateGeminiNarration: async (...args) => { calls++; received = args; return tone(2); } },
  });
  const track = await generateVideoAdNarration(segments, "gemini", "Charon", "en-US");
  assert.equal(calls, 1);
  assert.deepEqual(received, [segments.join("\n"), "Charon", "en-US"]);
  assert.deepEqual(track.starts, [0, 1.05]);
  delete process.env.GEMINI_API_KEY;
});

test("Gemini alignment cannot silently omit or replace a scene", async t => {
  process.env.GEMINI_API_KEY = "test-key";
  t.mock.method(globalThis, "fetch", async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"segments":[]}' }] } }] }));
  const { generateVideoAdNarration } = loadTs(new URL("../src/services/videoAdNarration.ts", import.meta.url), {
    "./geminiNarration": { generateGeminiNarration: async () => tone(2) },
  });
  await assert.rejects(generateVideoAdNarration(["First.", "Second."], "gemini", "Kore", "es-CO"), /guion completo/);
  delete process.env.GEMINI_API_KEY;
});

test("Gemini rejects absent audio and non-PCM responses, and sends the selected language", async t => {
  process.env.GEMINI_API_KEY = "test-key";
  const { generateGeminiNarration } = loadTs(new URL("../src/services/geminiNarration.ts", import.meta.url));
  let payload = {};
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.match(JSON.parse(options.body).contents[0].parts[0].text, /American English/);
    return Response.json(payload);
  });
  await assert.rejects(generateGeminiNarration("Hello.", "Charon", "en-US"), /no devolvió audio/);
  payload = { candidates: [{ content: { parts: [{ inlineData: { data: tone(1).toString("base64"), mimeType: "audio/mpeg" } }] } }] };
  await assert.rejects(generateGeminiNarration("Hello.", "Charon", "en-US"), /formato/);
  payload.candidates[0].content.parts[0].inlineData.mimeType = "audio/L16;codec=pcm;rate=24000";
  assert.deepEqual(await generateGeminiNarration("Hello.", "Charon", "en-US"), tone(1));
  delete process.env.GEMINI_API_KEY;
});

test("render endpoint sends one full narration and language to the renderer; invalid scenes never call TTS", async () => {
  let spoken, rendered, calls = 0;
  const mocks = {
    "@/lib/studioAccess": { getStudioAccess: async () => ({ clinic: { id: "test-clinic", name: "Clinic" } }) },
    "@/lib/prisma": { prisma: { brandProfile: { findUnique: async () => null } } },
    "@/services/videoAdNarration": { generateMeasuredVideoAdNarration: async (...args) => { calls++; spoken = args.slice(0, 5); return { pcm: tone(2), starts: [0, 1], segments: args[0] }; } },
    "@/services/videoAdRenderer": { validateAdScenes: scenes => { if (scenes[0].seconds < 1) throw new Error("duración inválida"); }, renderVideoAd: async (...args) => { rendered = args; return Buffer.from("mp4"); } },
  };
  const { POST } = loadTs(new URL("../src/app/api/video-ads/render/route.ts", import.meta.url), mocks);
  function request(seconds = 2, narration = "Your questions about restoration options deserve time in a consultation. Discuss your expectations with a professional before deciding.") {
    const form = new FormData();
    for (const [key, value] of Object.entries({ manifest: JSON.stringify([{ heading: "This model shows each tooth.", narration, seconds, kind: "image" }]), duration: "15", style: "premium", authorized: "true", language: "en-US", narrationProvider: "gemini", narration: "true", includeClosing: "true", closingText: "Message us on WhatsApp." })) form.set(key, value);
    form.set("file-0", new Blob([Buffer.from("image")], { type: "image/png" }), "test.png");
    return new Request("http://localhost/api/video-ads/render", { method: "POST", body: form });
  }
  assert.equal((await POST(request())).status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(spoken, [["Your questions about restoration options deserve time in a consultation. Discuss your expectations with a professional before deciding.", "Message us on WhatsApp."], "gemini", "Kore", "en-US", 15]);
  assert.equal(rendered[7], "en-US");
  assert.equal(rendered[8], 15);
  assert.deepEqual(rendered[6], { text: "Message us on WhatsApp." });
  assert.equal((await POST(request(2, ""))).status, 400);
  assert.equal((await POST(request(2, "Guaranteed pain-free results."))).status, 400);
  assert.equal((await POST(request(0))).status, 400);
  assert.equal(calls, 1);
});

test("script generation repairs rejected slogans without blocking on an inconclusive visual audit", async t => {
  process.env.GEMINI_API_KEY = "test-key";
  let requests = [];
  const tones = ["comercial"];
  function drafts(generic) { return { variants: tones.map(tone => ({ tone, narration: ["Your questions about restoration options deserve time in a consultation. Discuss your expectations with a professional before deciding."], title: "A closer look", opening: "See each tooth on this digital model.", message: "Bring your questions to a consultation.", closing: "Message us on WhatsApp.", scenes: [generic ? "Advanced digital planning for a personalized approach" : "Each tooth in this digital model."] })) }; }
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const answer = requests.length === 1 ? drafts(true) : drafts(false);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  });
  const { generateVideoAdDrafts } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  const variants = await generateVideoAdDrafts({ procedure: "Diseño de sonrisa", goal: "whatsapp", sceneCount: 1, duration: 15, clinicContext: "", visualDescriptions: ["Modelo digital de dientes en una pantalla."], language: "en-US" });
  assert.equal(variants.length, 1);
  assert.equal(requests.length, 2);
  assert.match(requests[1].systemInstruction.parts[0].text, /HUMANIZE DENTAL/);
  assert.match(requests[1].systemInstruction.parts[0].text, /No afirmes|No atribuyas/);
  await assert.rejects(generateVideoAdDrafts({ procedure: "x", goal: "whatsapp", sceneCount: 1, duration: 15, clinicContext: "" }), /descripciones visuales/);
  delete process.env.GEMINI_API_KEY;
});

test("6.79 seconds of narration becomes exactly 15 seconds without changing speech samples", () => {
  const pcm = tone(6.79);
  const starts = [0, 2.1, 4.3];
  const plan = timeline.planAdTimeline([5, 4, 6], 15, { pcm, starts });
  assert.equal(plan.durations.reduce((a, b) => a + b), 15);
  assert.equal(plan.narration.pcm.length, 15 * 48000);
  const cuts = [...starts.map(time => Math.round(time * 24000)), pcm.length / 2];
  for (let i = 0; i < 3; i++) {
    const original = pcm.subarray(cuts[i] * 2, cuts[i + 1] * 2);
    const offset = Math.round(plan.narration.starts[i] * 24000) * 2;
    assert.deepEqual(plan.narration.pcm.subarray(offset, offset + original.length), original);
    assert.ok(plan.durations[i] >= original.length / 48000 + 0.25);
  }
  assert.throws(() => timeline.planAdTimeline([5, 4, 6], 6, { pcm, starts }), /no cabe/);
  for (const target of [NaN, 0, 15.5, 61]) assert.throws(() => timeline.planAdTimeline([1], target));
  for (const target of [15, 30, 60]) {
    assert.equal(Math.round(timeline.planAdTimeline([1, 2, 6], target).durations.reduce((a, b) => a + b) * 24), target * 24);
  }
});

test("visual copy leaves wording to the editor while rejecting repeated scenes", () => {
  const { validateVisualNarrative } = loadTs(new URL("../src/services/videoAdCopy.ts", import.meta.url));
  const observations = ["Modelo dental digital en pantalla", "Modelo físico de dientes"];
  assert.doesNotThrow(() => validateVisualNarrative(["Digital mapping allows us to review your options.", "Physical models help us discuss your preferences."], observations));
  assert.doesNotThrow(() => validateVisualNarrative(["Physical models help us discuss your preferences."], [observations[1]]));
  assert.throws(() => validateVisualNarrative(["Ask about your options.", "Ask about your options."], observations), /repiten/);
  assert.doesNotThrow(() => validateVisualNarrative(["Bring your questions.", "This physical model shows tooth shapes."], observations));
  assert.doesNotThrow(() => validateVisualNarrative(["Notice each tooth's outline on this digital model.", "Now explore those shapes on a physical model."], observations));
});

test("brief ElevenLabs speech is rejected instead of filling the video with silence", async () => {
  let calls = 0;
  const original = { pcm: tone(2.4), starts: [0, 1.1, 1.9] };
  const { generateVideoAdNarration } = loadTs(new URL("../src/services/videoAdNarration.ts", import.meta.url), {
    "./elevenLabsNarration": { generateElevenLabsTimedNarration: async () => { calls++; return original; } },
  });
  const segments = ["See your dental structure in 3D detail.", "Compare those shapes in a physical model.", "Message us on WhatsApp."];
  await assert.rejects(generateVideoAdNarration(segments, "elevenlabs", "Kore", "en-US", 15), /demasiado breve/);
  assert.equal(calls, 1);
});

test("overlong ElevenLabs speech is rejected without paid retries", async () => {
  let calls = 0;
  const { generateVideoAdNarration } = loadTs(new URL("../src/services/videoAdNarration.ts", import.meta.url), {
    "./elevenLabsNarration": { generateElevenLabsTimedNarration: async () => { calls++; return { pcm: tone(14.5), starts: [0, 5, 10] }; } },
  });
  await assert.rejects(generateVideoAdNarration(["First.", "Second.", "Message us on WhatsApp."], "elevenlabs", "Kore", "en-US", 15), /más tiempo/);
  assert.equal(calls, 1);
});

test("timeline reserves readable scene and closing holds without discarding voice samples", () => {
  const plan = timeline.planAdTimeline([1, 1, 1], 15, { pcm: tone(8.25), starts: [0, 2.5, 5] }, [3, 3, 4]);
  assert.equal(Math.round(plan.durations.reduce((a, b) => a + b) * 24), 360);
  assert.ok(plan.durations[0] >= 3 && plan.durations[1] >= 3 && plan.durations[2] >= 4);
  assert.throws(() => timeline.planAdTimeline([1, 1, 1], 8, undefined, [3, 3, 4]), /no cabe/);
});

test("speech holds are balanced independently of storyboard weights", () => {
  const track = { pcm: tone(9), starts: [0, 2, 6] };
  const plan = timeline.planAdTimeline([1, 20, 1], 30, track);
  const holds = plan.durations.map((duration, i) => duration - [2, 4, 3][i]);
  assert.ok(Math.max(...holds) - Math.min(...holds) <= 1 / 24 + 1e-9);
  assert.equal(Math.round(plan.durations.reduce((a, b) => a + b) * 24), 720);
  for (let i = 0; i < 3; i++) {
    const start = Math.round(plan.narration.starts[i] * 48000);
    const original = track.pcm.subarray(track.starts[i] * 48000, (track.starts[i + 1] ?? 9) * 48000);
    assert.deepEqual(plan.narration.pcm.subarray(start, start + original.length), original);
  }
});

test("voice coverage rejects the reported five seconds in a thirty-second video", () => {
  assert.throws(() => timeline.validateNarrationCoverage(tone(23.9), 30), /demasiado breve/);
  assert.doesNotThrow(() => timeline.validateNarrationCoverage(tone(24), 30));
  assert.throws(() => timeline.validateNarrationCoverage(tone(5), 30), /demasiado breve/);
  const padded = Buffer.concat([tone(5), Buffer.alloc(25 * 48000)]);
  assert.equal(timeline.measureNarration(padded).seconds, 30);
  assert.throws(() => timeline.validateNarrationCoverage(padded, 30, true), /demasiado breve/);
  const interrupted = Buffer.concat([tone(11), Buffer.alloc(3 * 48000), tone(11)]);
  assert.throws(() => timeline.validateNarrationCoverage(interrupted, 30), /silencios prolongados/);
  assert.doesNotThrow(() => timeline.validateNarrationCoverage(tone(25), 30));
});

test("measured short voice is rewritten once, resynthesized and aligned to the new transcript", async () => {
  const original = ["Short scene.", "Message us on WhatsApp."];
  const revised = ["Expanded scene with questions for the consultation.", original[1]];
  let calls = 0, repairs = 0;
  const { generateMeasuredVideoAdNarration } = loadTs(new URL("../src/services/videoAdNarration.ts", import.meta.url), {
    "./elevenLabsNarration": { generateElevenLabsTimedNarration: async segments => {
      calls++;
      assert.deepEqual(segments, calls === 1 ? original : revised);
      return { pcm: tone(calls === 1 ? 5 : 25), starts: [0, calls === 1 ? 3 : 23] };
    } },
  });
  const result = await generateMeasuredVideoAdNarration(original, "elevenlabs", "Kore", "en-US", 30, async (segments, seconds) => {
    repairs++;
    assert.deepEqual(segments, original);
    assert.equal(seconds, 5);
    return revised;
  });
  assert.equal(calls, 2);
  assert.equal(repairs, 1);
  assert.deepEqual(result.starts, [0, 23]);
  assert.deepEqual(result.segments, revised);
  assert.equal(result.pcm.length / 48000, 25);
});

test("Gemini repairs five-second synthesis before alignment can mask insufficient coverage", async t => {
  const original = ["Short scene.", "Message us on WhatsApp."];
  const revised = ["Expanded narration for the entire scene.", original[1]];
  let syntheses = 0, alignments = 0, repairs = 0;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    alignments++;
    assert.equal(syntheses, 2, "short audio must not reach alignment");
    assert.match(JSON.parse(options.body).contents[0].parts[1].text, /Expanded narration/);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ segments: [
      { text: revised[0], start: 0, end: 23 }, { text: revised[1], start: 23, end: 25 },
    ] }) }] } }] });
  });
  const { generateMeasuredVideoAdNarration } = loadTs(new URL("../src/services/videoAdNarration.ts", import.meta.url), {
    "./geminiNarration": { generateGeminiNarration: async text => {
      syntheses++;
      assert.equal(text, (syntheses === 1 ? original : revised).join("\n"));
      return tone(syntheses === 1 ? 5 : 25);
    } },
  });
  try {
    const result = await generateMeasuredVideoAdNarration(original, "gemini", "Kore", "en-US", 30, async (_, seconds) => {
      repairs++;
      assert.equal(seconds, 5);
      return revised;
    });
    assert.deepEqual(result.segments, revised);
    assert.equal(syntheses, 2);
    assert.equal(alignments, 1);
    assert.equal(repairs, 1);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test("persistent five-second voice cannot loop or produce an export after repair", async () => {
  let calls = 0, repairs = 0;
  const { generateMeasuredVideoAdNarration } = loadTs(new URL("../src/services/videoAdNarration.ts", import.meta.url), {
    "./elevenLabsNarration": { generateElevenLabsTimedNarration: async () => { calls++; return { pcm: tone(5), starts: [0] }; } },
  });
  await assert.rejects(generateMeasuredVideoAdNarration(["Short."], "elevenlabs", "Kore", "en-US", 30, async () => {
    repairs++; return ["A longer revised narration."];
  }), /demasiado breve/);
  assert.equal(calls, 2);
  assert.equal(repairs, 1);
});

test("measured rewrite keeps the CTA and rejects clinical promises before resynthesis", async t => {
  process.env.GEMINI_API_KEY = "test-key";
  const safe = "Your questions about restoration options deserve time in a consultation. Discuss your expectations with a professional before deciding.";
  let generated = safe;
  t.mock.method(globalThis, "fetch", async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ narration: [generated] }) }] } }] }));
  const { expandMeasuredAdNarration } = loadTs(new URL("../src/services/aiProvider.ts", import.meta.url), { "./grokService": {} });
  try {
    assert.deepEqual(await expandMeasuredAdNarration(["Short.", "Message us on WhatsApp."], 5, 15, "en-US", true), [safe, "Message us on WhatsApp."]);
    generated = "Guaranteed pain-free results. " + safe;
    await assert.rejects(expandMeasuredAdNarration(["Short."], 5, 15, "en-US", false), /afirmaciones|prohibid/i);
  } finally { delete process.env.GEMINI_API_KEY; }
});

test("proportional narration keeps 15, 30 and 60 second speech in the matching scene", () => {
  for (const target of [15, 30, 60]) {
    const segmentCount = target / 5;
    const pcm = tone(target * 0.85);
    const starts = Array.from({ length: segmentCount }, (_, i) => i * 4.25);
    const plan = timeline.planAdTimeline(starts.map(() => 1), target, { pcm, starts });
    const measured = timeline.validateNarrationCoverage(plan.narration.pcm, target, true);
    assert.ok(measured.longestSilence < 1);
    assert.ok(measured.activeSeconds / target >= 0.84);
    for (let i = 0; i < segmentCount; i++) {
      const offset = Math.round(plan.narration.starts[i] * 48000);
      assert.deepEqual(plan.narration.pcm.subarray(offset, offset + 4.25 * 48000), pcm.subarray(starts[i] * 48000, (starts[i] + 4.25) * 48000));
    }
  }
});
