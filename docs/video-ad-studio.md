# Video Ad Studio: narration, copy and composition

## Behavior

- One TTS request reads all scene captions and the optional closing, in order. The text is limited to 2,400 characters; the resulting narration must fit within 60 seconds.
- ElevenLabs uses `/with-timestamps`, validates character alignment and maps it through leading/trailing PCM padding removal. Gemini TTS returns PCM; an audio-capable Gemini model then aligns each exact caption against that generated track. Invalid, missing, overlapping or out-of-range timings stop the render. There is no character-count timing fallback.
- The PCM processor trims provider padding only at the beginning and end. Internal breaths and pauses remain intact.
- Scene slots use whole 24 fps frames. Minimum holds allow reading at 2.5 words per second (at least two seconds per scene and three seconds for the closing). Extra time is distributed across slots. Both narrated and silent exports use cuts, never overlapping fades that reduce the duration.
- Photographs and clips retain their full field of view and aspect ratio, inside a light neutral canvas. No clinical crop, zoom, blurred duplicate, retouch or color adjustment is applied. Resizing and MP4 encoding still occur. A short clip holds its last frame if its narration is longer.
- The selected ad language controls generated copy, TTS and the default closing. Clinic names remain unchanged. The editor itself retains its Spanish interface.
- The closing is a separate typographic brand card with one complete WhatsApp CTA, selected caption font and a large optional logo. It has no simulated button, secondary CTA, footer or decorative rules. No sentence splitting or truncation discards part of the spoken closing.

## Script validation

Gemini Vision observations are required for each scene. Generation uses a word budget, continuity instructions and a separate closing. The single commercial variant passes deterministic checks for generic slogans, risky/unverified claims, duplicated scenes, production directions and common mixed-language CTAs. Rejected drafts are repaired using the prior response, original observations and specific validation issue (at most three attempts total). Every repaired response must pass the same validation.

Visual specificity checks are limited heuristics and Gemini audio alignment is model-based; these are not a guarantee of factual accuracy or word-perfect forced alignment. Review a real generated advertisement before campaign use. User notes and visible objects do not establish material composition, credentials, clinical results or diagnoses. No external publishing was added.

## Configuration

Existing `GEMINI_API_KEY`, `GEMINI_TTS_MODEL`, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are retained. Optional `GEMINI_ALIGNMENT_MODEL` defaults to `GEMINI_MODEL`, then `gemini-3.1-flash-lite`; it must accept audio input. Gemini alignment uses the same Gemini key and only sends generated narration, not clinical imagery. ElevenLabs narration does not require an additional Gemini request or key.

Scripts allow up to 180 seconds for bounded generation/repair attempts. Rendering allows up to 300 seconds; configure the deployment's request timeout accordingly. Existing clinic permissions, consent flow, upload limits, no-store responses and download-only behavior remain in place.

## Verification

```sh
npm ci
npx prisma generate
npx tsc --noEmit
npm test
npm run test:video-render
npm run build -- --webpack
```

The automated suite covers provider failures, full-script requests, language propagation, bad alignment, silence compaction, copy rejection/retry and route validation. Real FFmpeg tests cover portrait/landscape edge preservation, photo/video/CTA timing, both locales, voice with and without music, MP3 decoding and AAC output. Provider HTTP responses are mocked; no live provider credentials are needed. Set `VIDEO_AD_QA_DIR` to retain synthetic MP4s and frames for visual inspection.

On the implementation Windows environment, the default Turbopack build hit an internal child-process error. The production Webpack build passed. No live Gemini/ElevenLabs generation was performed because provider keys were not configured in that checkout.

Provider references: [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio), [ElevenLabs speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).


### Duración y ritmo de exportación

La duración objetivo enviada en `duration` incluye todas las escenas y el cierre.
Se distribuye en fotogramas a 24 fps; los tiempos del storyboard sirven como pesos.
Los clientes anteriores que omiten `duration` conservan la suma del storyboard más
6 segundos de cierre. Las transiciones no restan tiempo al anuncio.
La voz se genera una sola vez y se alinea con el audio real. Se conservan las pausas
internas y todas las muestras de voz; el tiempo sobrante se reparte como pausas
visuales después de cada frase. Una voz que no cabe se rechaza, nunca se acelera
ni se trunca. Una locución superior a 165 palabras/minuto se rechaza para regenerarla.
El presupuesto de guion reserva dos segundos de aire y usa dos palabras/segundo.
La validación comprueba detalles visuales conocidos, frases repetidas y fórmulas
vacías; no constituye una garantía semántica de coherencia ni de hechos clínicos.
Las fuentes clínicas se ajustan completas; los subtítulos se colocan 40 px debajo del
material horizontal o vertical, sin cubrirlo ni recortarlo.


### Guion comercial único y reparación

Gemini devuelve `variants` con una única entrada de tono `comercial`, y exactamente
una frase de escena por archivo, respetando su orden. El cierre es independiente.
Si faltan escenas, están vacías, sobran o el JSON está incompleto, se realizan hasta
dos intentos de reparación con el borrador anterior y las observaciones originales.
Cada respuesta completa vuelve a pasar los filtros clínicos, visuales, de idioma y
de duración. No se rellenan escenas con detalles clínicos inventados. Si persiste
el error, se informa y no se acepta un guion parcial.
La selección de ElevenLabs solo controla la voz durante el renderizado: el análisis
visual y el guion siguen usando Gemini, sin llamadas a síntesis de voz.


### Controles de exportación y composición

- `videoAdLayout.ts` mide los glifos de la fuente real: subtítulos y cierre de 88 px,
  máximo dos líneas, dentro de 900 px. No se comprimen letras, no se
  reduce su tamaño y no se descartan palabras. El texto que no cabe se rechaza.
- Las validaciones de texto y cierre ocurren antes de solicitar voz. Gemini también
  recibe estas restricciones y puede reparar un guion que no quepa.
- Cada escena se codifica con un número explícito de fotogramas. Antes de devolver
  el MP4, se decodifica la pista de video y se comprueban el total de fotogramas,
  la duración temporal, la duración del contenedor y la resolución 1080 × 1920.
- El navegador comprueba además los metadatos del archivo recibido. Un archivo corto
  no queda disponible para descarga. Las cabeceras `X-Video-Ad-Renderer` y
  `X-Video-Ad-Duration` permiten identificar el renderizador desplegado.
- Conservar una fuente horizontal completa limita su altura en un lienzo vertical:
  se usa el ancho completo sin recortar detalles ni generar extensiones ficticias.
- Regresión real: un archivo de 8,25 s se rechaza cuando se solicitan 15 s; una
  exportación de 15 s contiene exactamente 360 fotogramas a 24 fps.


### Corrección de calidad publicitaria (noviembre de 2026)

- Rechaza las frases reportadas “Exploring digital shapes together” y “Reviewing
  your personalized options”, también en español. Repara el guion con las
  observaciones originales; exige un detalle dental además del tipo de modelo.
  Las referencias a modelos digitales/físicos deben estar respaldadas por su
  escena (o ser una transición explícita desde la anterior).
- El prompt pide una conversación continua en es-CO/en-US, con un ejemplo
  condicionado al contenido observado y revisión de continuidad antes de responder.
  No presenta los objetos como prueba de diagnósticos, resultados o credenciales.
- Fondo verde profundo y texto marfil con contraste superior a 7:1. La imagen
  horizontal usa todo el ancho; la vertical puede ocupar 1320 px de altura.
  El subtítulo queda próximo a la imagen, fuera de su área clínica, y termina
  antes de y=1800. Dimensiones pares evitan problemas con video YUV420.
- El logo suministrado es la identidad única: hasta 900 × 360 px en el cierre,
  sin repetir el nombre de cuenta al lado. Así Dr Daniel Coy no compite con
  “Dental Studio”. Sin logo, se usa el nombre configurado a 88 px. No se
  cambia la identidad de otras clínicas ni se introduce una marca fija global.
- El cierre acepta una sola acción breve dirigida a WhatsApp; rechaza también
  dos acciones distintas aunque WhatsApp aparezca una sola vez.
- La línea de tiempo, muestreo de voz, permisos e integraciones se conservan.
  La regresión real verifica 360 cuadros, 15.00 s, 1080 × 1920 y audio AAC,
  con pistas sintéticas de 6.79 s, ambos idiomas y mezcla musical opcional.
  Estas pruebas no evalúan la pronunciación de una voz real de los proveedores.
