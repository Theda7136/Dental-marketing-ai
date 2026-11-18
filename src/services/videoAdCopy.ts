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

  const scenes = draft.scenes.map((caption, index) => {
    if (!looksLikeProductionInstruction(caption)) return caption;
    if (draft.scenes.length === 1) return draft.opening;
    if (index === 0) return draft.opening;
    if (index === draft.scenes.length - 1) return draft.closing;
    return draft.message;
  });

  return { ...draft, scenes };
}


const genericCopy = [
  /explor(?:e|ing) digital shapes|review(?:ing)? your personali[sz]ed options/i,
  /explor(?:ar|ando|emos) formas digitales|revis(?:ar|ando|emos) tus opciones personali[sz]adas/i,
  /advanced digital tools|herramientas digitales avanzadas/i,
  /advanced (?:digital )?(?:technology|planning)/i,
  /personalized approach|natural[- ]looking finish|quality materials/i,
  /tecnolog[ií]a avanzada|dise[nñ]o personalizado|materiales de (?:alta )?calidad|resultados precisos/i,
  /transform(?:a|amos|ing)? (?:tu|your) (?:sonrisa|smile)|sonrisa de tus sue[nñ]os|smile of your dreams/i,
  /instalaciones equipadas para ti|an[aá]lisis cl[ií]nico profesional/i,
];
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
  if (genericCopy.some(pattern => pattern.test(text))) {
    throw new Error("El guion contiene frases genéricas. Describe un detalle visible concreto y su relación con la consulta.");
  }
  if (unsupportedClaims.some(pattern => pattern.test(text))) {
    throw new Error("El guion contiene afirmaciones no verificadas sobre materiales, resultados o credenciales.");
  }
  if ((language === "en-US" && /\b(?:agenda tu|cont[aá]ctanos|valoraci[oó]n|sonrisa|escr[ií]benos|conoce tus)\b/i.test(text)) ||
      (language === "es-CO" && /\b(?:book your|contact us|your smile|schedule your|message us)\b/i.test(text))) {
    throw new Error("El guion mezcla idiomas. Usa únicamente el idioma seleccionado.");
  }
}

export function validateVisualNarrative(scenes: string[], observations: string[]): void {
  if (observations.length !== scenes.length) throw new Error("Las observaciones no coinciden con las escenas.");
  const normalized = scenes.map(text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
  if (new Set(normalized).size !== scenes.length) throw new Error("Las escenas repiten la misma idea; construye una historia conectada.");
  const anchors = [
    { observed: /digital|pantalla|screen|\bCAD\b/i, copy: /digital|screen|pantalla/i },
    { observed: /modelo f[ií]sico|physical model|yeso|plaster|\bcast\b/i, copy: /f[ií]sic|physical|model|molde/i },
  ];
  scenes.forEach((text, i) => {
    validateCommercialText(text);
    if (/\b(?:whatsapp|agenda|reserva|book|contact us|cont[aá]ctanos|message us)\b/i.test(text)) {
      throw new Error("Reserva la llamada a la acción para el cierre; desarrolla aquí el detalle visible.");
    }
    const observation = observations[i] ?? "";
    // A dental observation should inform the copy, but a keyword checklist
    // cannot reliably judge whether a sentence is specific or natural.
    if (/^(?:explore|review|discover|discuss|consider|conoce|explora|revisa|descubre|conversemos)(?:mos)?\\b.*\\b(?:options|opciones|possibilities|posibilidades|preferences|preferencias)\\b[.!?]?$/i.test(text.trim()) &&
        /digital|pantalla|screen|modelo|model|yeso|plaster|\\bcast\\b/i.test(observation)) {
      throw new Error(`La escena ${i + 1} es demasiado genérica; conecta el texto con el material visual.`);
    }
    // A later source must not inherit an object merely mentioned in an earlier one.
    for (const anchor of anchors) {
      if (anchor.copy.test(text) && /digital|screen|pantalla|f[ií]sic|physical/i.test(text) &&
          !anchor.observed.test(observation) &&
          !(i > 0 && /\b(?:from|del|desde)\b/i.test(text) && anchor.observed.test(observations[i - 1])) &&
          ((anchor === anchors[0] && /digital|screen|pantalla/i.test(text)) ||
           (anchor === anchors[1] && /f[ií]sic|physical/i.test(text)))) {
        throw new Error(`La escena ${i + 1} añade un objeto no respaldado por su observación visual.`);
      }
    }
    for (const anchor of anchors) {
      if (anchor.observed.test(observations[i] ?? "") && !anchor.copy.test(text)) {
        throw new Error(`La escena ${i + 1} omite su detalle visual principal. Conecta ese detalle con la historia sin inventar resultados.`);
      }
    }
    if (/^(?:digital mapping|physical models?) (?:allows? us|helps? us) (?:to )?(?:review|discuss) your (?:options|preferences)\.?$/i.test(text.trim()) ||
        /^(?:mapeo digital|modelos? f[ií]sicos?) (?:nos )?permiten? (?:revisar|discutir) tus (?:opciones|preferencias)\.?$/i.test(text.trim())) {
      throw new Error("El guion contiene frases genéricas sobre herramientas; relaciona un detalle visible con una pregunta concreta del paciente.");
    }
  });
}
