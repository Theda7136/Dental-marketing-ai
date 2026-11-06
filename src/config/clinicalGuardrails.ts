/**
 * Guardrails clínicos para la IA de marketing dental.
 *
 * Este módulo es la única fuente de verdad para decidir si un texto
 * promocional puede publicarse. No inventa diagnósticos ni promete
 * resultados médicos: solo permite terminología odontológica reconocida
 * y bloquea afirmaciones de riesgo.
 */

/** Términos odontológicos reconocidos que la IA puede usar con seguridad. */
const ALLOWED_DENTAL_TERMS = [
  "Endodoncia",
  "Ortodoncia",
  "Diseño de Sonrisa",
  "Blanqueamiento Dental",
  "Profilaxis",
  "Periodoncia",
  "Implantes Dentales",
  "Carillas Dentales",
  "Odontología Estética",
  "Limpieza Dental",
] as const;

/**
 * Frases que la IA de marketing no debe usar bajo ninguna circunstancia.
 * Son promesas absolutas, garantías permanentes o curas milagrosas.
 */
const PROHIBITED_RISK_PHRASES = [
  "cura milagrosa",
  "dientes blancos garantizados para siempre",
  "sin ningún dolor absoluto",
  "resultados garantizados",
  "100% efectivo",
  "sin efectos secundarios",
  "tratamiento milagroso",
  "sin riesgo alguno",
  "elimina el dolor para siempre",
  "garantizado de por vida",
] as const;

export type AllowedDentalTerm = (typeof ALLOWED_DENTAL_TERMS)[number];

export type ProhibitedRiskPhrase = (typeof PROHIBITED_RISK_PHRASES)[number];

/** Error lanzado cuando un texto de marketing incumple un guardrail clínico. */
export class ClinicalGuardrailWarning extends Error {
  readonly matches: readonly ProhibitedRiskPhrase[];

  constructor(matches: readonly ProhibitedRiskPhrase[]) {
    const listed = matches.map((phrase) => `"${phrase}"`).join(", ");
    super(
      `Advertencia clínica: el texto de marketing contiene frases prohibidas: ${listed}.`,
    );
    this.name = "ClinicalGuardrailWarning";
    this.matches = matches;
  }
}

/**
 * Normaliza texto para comparar sin depender de mayúsculas,
 * tildes ni espacios repetidos.
 */
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Valida un texto de marketing dental.
 *
 * @returns `true` cuando el texto no contiene frases de riesgo.
 * @throws {TypeError} si `text` no es un string.
 * @throws {ClinicalGuardrailWarning} si detecta una o más frases prohibidas.
 */
export function validateMarketingText(text: string): true {
  if (typeof text !== "string") {
    throw new TypeError("El texto de marketing debe ser un string.");
  }

  const normalizedText = normalizeForMatch(text);
  const matches = PROHIBITED_RISK_PHRASES.filter((phrase) =>
    normalizedText.includes(normalizeForMatch(phrase)),
  );

  if (matches.length > 0) {
    throw new ClinicalGuardrailWarning(matches);
  }

  return true;
}

/**
 * Configuración inmutable de los guardrails clínicos.
 * Los arreglos están congelados para impedir mutaciones en runtime.
 */
export const clinicalGuardrails = Object.freeze({
  allowedDentalTerms: Object.freeze([...ALLOWED_DENTAL_TERMS]),
  prohibitedRiskPhrases: Object.freeze([...PROHIBITED_RISK_PHRASES]),
  validate: validateMarketingText,
});

export type ClinicalGuardrailsConfig = typeof clinicalGuardrails;
