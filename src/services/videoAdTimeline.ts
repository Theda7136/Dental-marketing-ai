export type NarrationTrack = { pcm: Buffer; starts: number[] };
const RATE = 24000;

// Preserve all internal pauses; only trim provider padding at the edges. PCM is
// mono signed 16-bit little endian at 24 kHz throughout the pipeline.
export function compactNarration(pcm: Buffer) {
  if (!pcm.length || pcm.length % 2 || pcm.length > RATE * 2 * 90) {
    throw new Error("La narración está vacía, es inválida o supera 90 segundos.");
  }
  const window = 240;
  const active: boolean[] = [];
  for (let offset = 0; offset < pcm.length / 2; offset += window) {
    let energy = 0;
    const count = Math.min(window, pcm.length / 2 - offset);
    for (let i = 0; i < count; i++) energy += (pcm.readInt16LE((offset + i) * 2) / 32768) ** 2;
    active.push(Math.sqrt(energy / count) > 0.003);
  }
  const first = active.indexOf(true);
  const last = active.lastIndexOf(true);
  if (first < 0) throw new Error("El proveedor devolvió una narración silenciosa.");
  const keep: { from: number; to: number; output: number }[] = [];
  let output = 0;
  for (let i = Math.max(0, first - 3); i <= Math.min(active.length - 1, last + 5);) {
    let end = i + 1;
    while (end < active.length && active[end] === active[i]) end++;
    end = Math.min(end, last + 6);
    const count = end - i;
    const from = i * window * 2;
    const to = Math.min(pcm.length, (i + count) * window * 2);
    keep.push({ from, to, output });
    output += to - from;
    i = end;
  }
  const result = Buffer.concat(keep.map(range => pcm.subarray(range.from, range.to)));
  return {
    pcm: result,
    mapTime(seconds: number) {
      const byte = seconds * RATE * 2;
      for (const range of keep) {
        if (byte <= range.to) return (range.output + Math.max(0, byte - range.from)) / (RATE * 2);
      }
      return result.length / (RATE * 2);
    },
  };
}

export function narrationDurations(track: NarrationTrack, count: number, fps = 24): number[] {
  const duration = track.pcm.length / (RATE * 2);
  if (!track.pcm.length || track.pcm.length % 2 || duration > 60 || track.starts.length !== count) {
    throw new Error("La narración debe estar completa y durar como máximo 60 segundos.");
  }
  const frames = track.starts.map(time => Math.round(time * fps));
  if (track.starts.some(time => !Number.isFinite(time) || time < 0 || time >= duration) ||
      frames[0] !== 0 || frames.some((frame, i) => i > 0 && frame <= frames[i - 1])) {
    throw new Error("No se pudo sincronizar la narración con todas las escenas. Vuelve a generar la voz.");
  }
  const end = Math.ceil(duration * fps);
  if (frames[frames.length - 1] >= end) throw new Error("La última escena no tiene duración suficiente para sincronizarse.");
  return frames.map((frame, i) => ((frames[i + 1] ?? end) - frame) / fps);
}

export function pcmWave(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Allocate whole frames, keeping every speech sample at its original sample rate.
// Extra time is held after each phrase, never by stretching or speeding up speech.
export function planAdTimeline(weights: number[], targetSeconds: number, track?: NarrationTrack, minimumSeconds?: number[]) {
  const fps = 24;
  if (!weights.length || weights.some(value => !Number.isFinite(value) || value <= 0) ||
      !Number.isInteger(targetSeconds) || targetSeconds < 1 || targetSeconds > 60) {
    throw new Error("La duración objetivo debe estar entre 1 y 60 segundos.");
  }
  if (minimumSeconds && (minimumSeconds.length !== weights.length || minimumSeconds.some(value => !Number.isFinite(value) || value < 0))) throw new Error("Tiempos de lectura inválidos.");
  if (track) narrationDurations(track, weights.length);
  const cuts = track ? [...track.starts.map((time, index) => index === 0 ? 0 : Math.round(time * RATE)), track.pcm.length / 2] : [];
  const minimum = weights.map((_, i) => Math.max(Math.ceil((minimumSeconds?.[i] ?? 1) * fps), track
    ? Math.ceil((cuts[i + 1] - cuts[i]) / RATE * fps) + 6
    : fps));
  const remaining = targetSeconds * fps - minimum.reduce((a, b) => a + b, 0);
  if (remaining < 0) throw new Error("La narración no cabe con pausas naturales. Acorta el guion o elige una duración mayor; no se acelerará la voz.");
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map(weight => remaining * weight / totalWeight);
  const frames = minimum.map((value, i) => value + Math.floor(shares[i]));
  let extra = targetSeconds * fps - frames.reduce((a, b) => a + b, 0);
  const order = shares.map((value, i) => ({ i, fraction: value % 1 })).sort((a, b) => b.fraction - a.fraction);
  for (const { i } of order) if (extra-- > 0) frames[i]++;
  const durations = frames.map(value => value / fps);
  if (!track) return { durations, narration: undefined };
  const pcm = Buffer.alloc(targetSeconds * RATE * 2);
  const starts: number[] = [];
  let frame = 0;
  frames.forEach((length, i) => {
    starts.push(frame / fps);
    track.pcm.copy(pcm, frame * (RATE / fps) * 2, cuts[i] * 2, cuts[i + 1] * 2);
    frame += length;
  });
  return { durations, narration: { pcm, starts } };
}
