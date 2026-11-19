export type AdNarrative = {
  opening: string;
  message: string;
  closing: string;
  scenes: string[];
};

const productionLanguage = [
  /\b(?:imagen|fotograf[ií]a|foto|video|clip|toma|plano|escena|secuencia)\s+(?:de|del|con|en|mostrando|donde)\b/i,
  /\b(?:mostrar|muestra|colocar|insertar|agregar|añadir|utilizar|poner|incluir|aparecer|visualizar|enfocar|hacer zoom|cortar a)\s+(?:una?\s+|el\s+|la\s+|los\s+|las\s+)?(?:imagen|foto|video|clip|texto|logo|icono|ícono|fachada|recepci[oó]n|paciente|doctor|profesional)\b/i,
  /\b(?:llamado a la acci[oó]n|call to action|cta|icono|ícono|transici[oó]n|fundido|zoom|voz en off|subt[ií]tulo|m[uú]sica de fondo|sobreimpresi[oó]n|pantalla dividida|historia cl[ií]nica)\b/i,
  /\b(?:fachada|recepci[oó]n|consultorio|odont[oó]logo revisando|profesional revisando)\b/i,
];

export function looksLikeProductionInstruction(text: string): boolean {
  return productionLanguage.some(pattern => pattern.test(text));
}

export function normalizeVideoAdCopy(draft: AdNarrative): AdNarrative {
  const keyLines = [draft.opening, draft.message, draft.closing];
  if (keyLines.some(text => looksLikeProductionInstruction(text))) {
    throw new Error("El guion contiene instrucciones de producción en lugar de texto publicitario.");
  }

  // Never replace a scene with the closing CTA: that manufactures the very
  // duplication rejected downstream and loses the scene's visual reference.
  // Let the bounded generation retry repair the original production direction.
  if (draft.scenes.some(looksLikeProductionInstruction)) {
    throw new Error("El guion contiene instrucciones de producción en lugar de texto publicitario.");
  }
  const scenes = draft.scenes;

  return { ...draft, scenes };
}


const unsupportedClaims = [
  /\b(?:you have|you suffer from|tienes|padeces)\b.*\b(?:cavit|caries|disease|enfermedad|gingivitis|periodontitis)/i,
  /\b(?:cures?|corrects?|restores?|eliminates?|cura|corrige|restaura|elimina)\b.*\b(?:teeth|smile|bite|dientes|sonrisa|mordida)/i,
  /guarantee(?:d|s)?|pain[- ]?free|risk[- ]?free|no side effects|permanent results|100\s*%/i,
  /sin dolor|sin riesgos?|sin efectos secundarios|garantizad[oa]s?|resultados permanentes/i,
  /(?:best|finest|superior|highest)[ -](?:quality|materials|results|dentist)|board[- ]certified/i,
  /(?:mejores|superiores) (?:materiales|resultados)|certificad[oa]s?|alta precisi[oó]n/i,
  /(?:zirconia|zirconio|porcelain|porcelana|titanium|titanio)|before and after|antes y despu[eé]s/i,
  /(?:in|en) (?:just |solo )?\d+ (?:days?|d[ií]as?|sessions?|sesiones)|\$\s*\d+/i,
];

export function validateCommercialText(text: string, language?: "es-CO" | "en-US"): void {
  if (looksLikeProductionInstruction(text)) throw new Error("El texto contiene instrucciones de producción.");
  if (!text.trim()) throw new Error("El texto publicitario no puede estar vacío.");
  if (unsupportedClaims.some(pattern => pattern.test(text))) {
    throw new Error("El guion contiene afirmaciones no verificadas sobre materiales, resultados o credenciales.");
  }
  if ((language === "en-US" && /\b(?:agenda tu|cont[aá]ctanos|valoraci[oó]n|sonrisa|escr[ií]benos|conoce tus)\b/i.test(text)) ||
      (language === "es-CO" && /\b(?:book your|contact us|your smile|schedule your|message us)\b/i.test(text))) {
    throw new Error("El guion mezcla idiomas. Usa únicamente el idioma seleccionado.");
  }
}

// Conservative editorial fingerprints, not clinical inference or embeddings.
// Keep concrete objects: digital and physical models can advance the story.
export function narrativeFingerprint(text: string): Set<string> {
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\b(?:take a closer look|look closer|explore|discover|review|learn about|conoce|explora|descubre|revisa)\b/g, " explore ")
    .replace(/\b(?:choices|alternatives|opciones|alternativas)\b/g, "options")
    .replace(/\b(?:discuss|talk about|conversa sobre|habla sobre)\b/g, "discuss")
    .replace(/\b(?:want to achieve|would like|desire|deseas|quieres lograr)\b/g, "want")
    .replace(/\b(?:sonrisa)\b/g, "smile");
  const stop = new Set("a an the your you our us to at of in on and with for this that take closer look tus tu sus el la los las de del en un una y con para sobre".split(" "));
  return new Set((normalized.match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !stop.has(word)));
}

export function validateVisualNarrative(scenes: string[], observations: string[]): void {
  if (observations.length !== scenes.length) throw new Error("Las observaciones no coinciden con las escenas.");
  const normalized = scenes.map(text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  if (new Set(normalized).size !== scenes.length) throw new Error("Las escenas repiten la misma idea; construye una historia conectada.");
  const fingerprints = scenes.map(narrativeFingerprint);
  fingerprints.forEach((words, i) => {
    for (let j = 0; j < i; j++) {
      const common = [...words].filter(word => fingerprints[j].has(word)).length;
      const union = new Set([...words, ...fingerprints[j]]).size;
      if (common >= 2 && common / union >= 0.8) {
        throw new Error(`Las escenas ${j + 1} y ${i + 1} repiten la misma idea; añade información distinta respaldada por el material confirmado.`);
      }
    }
  });
  scenes.forEach((text, i) => {
    validateCommercialText(text);
    if (/\b(?:whatsapp|agenda|reserva|book|contact us|cont[aá]ctanos|message us)\b/i.test(text)) {
      throw new Error("Reserva la llamada a la acción para el cierre; desarrolla aquí el detalle visible.");
    }
  });
}

export function narrationWordBudget(seconds: number) {
  return { minimum: Math.ceil(seconds * 1.45), maximum: Math.floor(seconds * 2) };
}

export function validateNarrationScript(segments: unknown, count: number, closing: string, seconds: number, language?: "es-CO" | "en-US"): asserts segments is string[] {
  if (!Array.isArray(segments) || segments.length !== count || segments.some(text => typeof text !== "string" || !text.trim() || text.length > 1800)) {
    throw new Error("Completa una narración independiente por escena; los subtítulos no sustituyen la explicación hablada.");
  }
  segments.forEach(text => validateCommercialText(text, language));
  validateVisualNarrative(segments, segments.map(() => ""));
  const text = [...segments, closing].join(" ").trim();
  const words = text.split(/\s+/).length;
  const budget = narrationWordBudget(seconds);
  if (text.length > 2400 || words < budget.minimum || words > budget.maximum) {
    throw new Error(`La narración para ${seconds} segundos necesita entre ${budget.minimum} y ${budget.maximum} palabras, incluido el cierre; recibimos ${words}. Amplía la explicación contextual sin inventar hechos clínicos o ajusta la duración.`);
  }
}
