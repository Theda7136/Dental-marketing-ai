import { loadTs } from "./helpers/load-ts.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(new URL("../src/services/videoAdRenderer.ts", import.meta.url));
const sharp = require("sharp");
const { renderVideoAd } = loadTs(new URL("../src/services/videoAdRenderer.ts", import.meta.url));

test("FFmpeg renders an actual branded vertical MP4 from one real PNG", { timeout: 180_000 }, async () => {
  const png = await sharp({
    create: { width: 320, height: 240, channels: 3, background: "#d2ebe2" },
  }).png().toBuffer();

  const mp4 = await renderVideoAd([{
    filename: "test.png",
    bytes: png,
    kind: "image",
    seconds: 1,
    heading: "Conoce nuestra clínica",
  }], {
    clinicName: "Clinica piloto",
    primaryColor: "#116D60",
    logoDataUrl: null,
  });

  assert.ok(mp4.length > 1_000);
  assert.equal(mp4.toString("ascii", 4, 8), "ftyp");
});

test("FFmpeg renders an opening, branded closing and two selected styles", { timeout: 180_000 }, async () => {
  const first = await sharp({
    create: { width: 420, height: 260, channels: 3, background: "#c2e4d8" },
  }).png().toBuffer();
  const second = await sharp({
    create: { width: 260, height: 420, channels: 3, background: "#e7ccbd" },
  }).png().toBuffer();
  const scenes = [
    { filename: "opening.png", bytes: first, kind: "image", seconds: 1, heading: "Una sonrisa empieza aquí" },
    { filename: "closing.png", bytes: second, kind: "image", seconds: 1, heading: "Agenda tu valoración" },
  ];
  const brand = { clinicName: "Clínica de prueba", primaryColor: "#116D60", logoDataUrl: null };

  for (const style of ["dinamico", "educativo"]) {
    const mp4 = await renderVideoAd(scenes, brand, style);
    assert.ok(mp4.length > 1_000);
    assert.equal(mp4.toString("ascii", 4, 8), "ftyp");
  }
});
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const ffmpeg = require("ffmpeg-static");
function ff(args) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true, maxBuffer: 10_000_000 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function pcmTone(seconds, frequency = 220) {
  const pcm = Buffer.alloc(Math.round(seconds * 24000) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i * 2 * Math.PI * frequency / 24000)), i * 2);
  return pcm;
}

test("continuous narration survives scene/CTA boundaries, music ducking and both locales", { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "video-ad-test-"));
  try {
    const source = path.join(directory, "clip.mp4");
    ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
    const clip = await readFile(source);
    const png = await sharp({ create: { width: 360, height: 640, channels: 3, background: "#c5ded8" } }).png().toBuffer();
    const music = path.join(directory, "music.wav");
    ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", music]);
    const brand = { clinicName: "Clínica Demo", primaryColor: "#b7a479", logoDataUrl: null };
    for (const language of ["en-US", "es-CO"]) {
      const scenes = [
        { filename: "photo.png", bytes: png, kind: "image", seconds: 10, heading: language === "en-US" ? "A closer look at each tooth." : "Una mirada a la forma de cada diente." },
        { filename: "clip.mp4", bytes: clip, kind: "video", seconds: 10, heading: language === "en-US" ? "Bring your questions to your consultation." : "Trae tus preguntas a la consulta." },
      ];
      const pcm = pcmTone(3.4);
      const overlays = [];
      const localizedRenderer = loadTs(new URL("../src/services/videoAdRenderer.ts", import.meta.url), {
        sharp: (...args) => {
          if (Buffer.isBuffer(args[0]) && args[0].toString("utf8", 0, 4) === "<svg") overlays.push(args[0].toString());
          const instance = sharp(...args);
          const composite = instance.composite;
          instance.composite = function(layers) {
            for (const layer of layers) {
              if (Buffer.isBuffer(layer.input) && layer.input.toString("utf8", 0, 4) === "<svg") overlays.push(layer.input.toString());
            }
            return composite.call(this, layers);
          };
          return instance;
        },
      });
      const mp4 = await localizedRenderer.renderVideoAd(scenes, brand, "premium", { pcm, starts: [0, 1.1, 2.2] },
        language === "en-US" ? { bytes: await readFile(music), extension: "wav", volume: 0.18 } : undefined,
        "georgia", { text: language === "en-US" ? "Explore your options. Message us on WhatsApp." : "Conoce tus opciones. Escríbenos por WhatsApp." }, language);
      const text = overlays.join(" ");
      if (language === "en-US") {
        assert.match(text, /Book a consultation/);
        assert.match(text, /Information · Professional consultation/);
        assert.doesNotMatch(text, /Agenda tu|valoración|Contáctanos|Escríbenos|Contenido informativo/);
      } else {
        assert.match(text, /Agenda tu valoración/);
        assert.doesNotMatch(text, /Book a consultation|Professional consultation|Message us/);
      }
      const output = path.join(directory, `${language}.mp4`);
      await writeFile(output, mp4);
      const decoded = ff(["-i", output, "-vn", "-ar", "24000", "-ac", "1", "-f", "s16le", "pipe:1"]);
      assert.ok(Math.abs(decoded.length / 48000 - 3.4) < 0.1, "voice duration must replace the 26-second storyboard");
      // No artificial silent holes at cuts or the CTA; allow the final encoder frame.
      for (let offset = 0; offset < decoded.length - 4800; offset += 2400) {
        let energy = 0;
        for (let i = offset; i < offset + 2400; i += 2) energy += decoded.readInt16LE(i) ** 2;
        assert.ok(Math.sqrt(energy / 1200) > 500, `silence at ${offset / 48000}s`);
      }
      const inspection = spawnSync(ffmpeg, ["-hide_banner", "-i", output], { windowsHide: true }).stderr.toString();
      assert.match(inspection, /1080x1920/);
      assert.match(inspection, /Audio: aac/);
      if (process.env.VIDEO_AD_QA_DIR) {
        await mkdir(process.env.VIDEO_AD_QA_DIR, { recursive: true });
        await copyFile(output, path.join(process.env.VIDEO_AD_QA_DIR, `${language}.mp4`));
        for (const [name, time] of [["photo", 0.5], ["clip", 1.5], ["cta", 2.6]]) {
          ff(["-ss", String(time), "-i", output, "-frames:v", "1", path.join(process.env.VIDEO_AD_QA_DIR, `${language}-${name}.png`)]);
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("photo composition preserves both edges of portrait and landscape clinical sources", async () => {
  const { preparePhotoScene } = loadTs(new URL("../src/services/videoAdRenderer.ts", import.meta.url));
  for (const [width, height] of [[400, 200], [200, 400]]) {
    const source = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white"/><rect width="20" height="${height}" fill="red"/><rect x="${width - 20}" width="20" height="${height}" fill="blue"/></svg>`);
    const png = await sharp(source).png().toBuffer();
    const composed = await preparePhotoScene(png);
    const { data, info } = await sharp(composed).raw().toBuffer({ resolveWithObject: true });
    let red = 0, blue = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 240 && data[i + 1] < 10 && data[i + 2] < 10) red++;
      if (data[i] < 10 && data[i + 1] < 10 && data[i + 2] > 240) blue++;
    }
    assert.ok(red > 10000 && blue > 10000);
    assert.ok(Math.abs(red - blue) / Math.max(red, blue) < 0.05);
  }
});

test("ElevenLabs timestamps survive MP3 decoding and silence compaction", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "eleven-ad-test-"));
  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.ELEVENLABS_VOICE_ID = "test-voice";
  try {
    const filename = path.join(directory, "voice.mp3");
    ff(["-f", "lavfi", "-i", "sine=frequency=220:duration=2", filename]);
    const audio = (await readFile(filename)).toString("base64");
    const segments = ["Hello.", "Ask us."];
    const chars = Array.from(segments.join("\n"));
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls++;
      assert.match(url, /with-timestamps/);
      assert.equal(JSON.parse(options.body).language_code, "en");
      return Response.json({ audio_base64: audio, alignment: { characters: chars,
        character_start_times_seconds: chars.map((_, i) => i * 0.13),
        character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.13) } });
    });
    const { generateVideoAdNarration } = loadTs(new URL("../src/services/videoAdNarration.ts", import.meta.url));
    const track = await generateVideoAdNarration(segments, "elevenlabs", "Kore", "en-US");
    assert.equal(calls, 1);
    assert.ok(Math.abs(track.starts[1] - 0.91) < 0.05);
    assert.ok(track.pcm.length > 90000);
  } finally {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
    await rm(directory, { recursive: true, force: true });
  }
});
