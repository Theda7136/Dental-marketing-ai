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
