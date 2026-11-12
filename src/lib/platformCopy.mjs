const IG_HASHTAG_LIMIT = 5;
const FB_HASHTAG_LIMIT = 2;

function hashtagsIn(text) {
  return [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])];
}

function sentencesWithoutTrailingCTA(text) {
  return text.trim()
    .replace(/(?:\s|^)(?:Haz clic en el enlace de (?:nuestra|la) biograf[ií]a|Visita el enlace de (?:nuestra|la) biograf[ií]a)[.!]?\s*$/iu, "")
    .trim();
}

export function platformCaptions(caption) {
  const sections = String(caption || "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const allTags = hashtagsIn(sections.join(" "));
  const plain = sections.filter((part) => !/^\s*(?:#[\p{L}\p{N}_]+\s*)+$/u.test(part));
  let body = sentencesWithoutTrailingCTA(plain[0] || "");
  const explicitCta = plain.slice(1).join(" ").trim();
  const hasCallToAction = /(?:agenda|escr[ií]benos|cont[aá]ctanos|consulta|valoraci[oó]n|te invitamos|¿te gustar[ií]a)/iu.test(body);

  if (!body) body = "Consulta con nuestro equipo odontológico para recibir información sobre el procedimiento.";
  const facebookCta = /biograf[ií]a|enlace de (?:nuestro|el) perfil/iu.test(explicitCta)
    ? "Escríbenos para solicitar información sobre una valoración."
    : explicitCta || "Escríbenos para solicitar información sobre una valoración.";
  const instagramCta = /biograf[ií]a|enlace de (?:nuestro|el) perfil/iu.test(explicitCta)
    ? "Escríbenos por mensaje directo para conocer más."
    : explicitCta || "Escríbenos por mensaje directo para recibir información.";

  const facebook = [body, hasCallToAction ? "" : facebookCta, allTags.slice(0, FB_HASHTAG_LIMIT).join(" ")]
    .filter(Boolean).join("\n\n");
  const shortBody = body.length > 360 ? body.slice(0, 357).replace(/\s+\S*$/, "") + "…" : body;
  const instagram = [shortBody, hasCallToAction ? "" : instagramCta, allTags.slice(0, IG_HASHTAG_LIMIT).join(" ")]
    .filter(Boolean).join("\n\n");
  return { facebook, instagram };
}
