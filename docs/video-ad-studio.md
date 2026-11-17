# Video Ad Studio: narration, copy and composition

## Behavior

- One TTS request reads all scene captions and the optional closing, in order. The text is limited to 2,400 characters; the resulting narration must fit within 60 seconds.
- ElevenLabs uses `/with-timestamps`, validates character alignment and maps it through PCM silence removal. Gemini TTS returns PCM; an audio-capable Gemini model then aligns each exact caption against that generated track. Invalid, missing, overlapping or out-of-range timings stop the render. There is no character-count timing fallback.
- The PCM processor removes leading/trailing padding and caps quiet runs longer than 300 ms at 200 ms, keeping short breaths. Detection uses 10 ms RMS windows at approximately -50 dBFS. This removes dead air, not all natural pauses.
- Spoken scene boundaries are rounded to the nearest 24 fps frame; the last frame rounds up, adding at most 42 ms. Narrated scenes use clean cuts so crossfades cannot shorten the voice or overlap captions. Without narration, the existing timed scenes, music and style-based transitions remain available.
- Photographs and clips retain their full field of view and aspect ratio, inside a solid brand canvas. No clinical crop, zoom, blurred duplicate, retouch or color adjustment is applied. Resizing and MP4 encoding still occur. A short clip holds its last frame if its narration is longer.
- The selected ad language controls generated copy, TTS, informational footer, default closing and contact label. Clinic names remain unchanged. The editor itself retains its Spanish interface.
- The closing is a separate typographic brand card with the complete CTA, selected caption font, brand accent and optional logo. No sentence splitting or truncation discards part of the spoken closing.

## Script validation

Gemini Vision observations are required for each scene. Generation uses a word budget, continuity instructions and a separate closing. The single commercial variant passes deterministic checks for generic slogans, risky/unverified claims, duplicated scenes, production directions and common mixed-language CTAs. Rejected drafts are repaired using the prior response, original observations and specific validation issue (at most three attempts total). Every repaired response must pass the same validation.

The semantic audit and Gemini audio alignment are model-based checks, not a guarantee of factual accuracy or word-perfect forced alignment. Review a real generated advertisement before campaign use. User notes and visible objects do not establish material composition, credentials, clinical results or diagnoses. No external publishing was added.

## Configuration

Existing `GEMINI_API_KEY`, `GEMINI_TTS_MODEL`, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are retained. Optional `GEMINI_ALIGNMENT_MODEL` defaults to `GEMINI_MODEL`, then `gemini-3.1-flash-lite`; it must accept audio input. Gemini alignment uses the same Gemini key and only sends generated narration, not clinical imagery. ElevenLabs narration does not require an additional Gemini request or key.

Scripts allow up to 180 seconds for bounded generation/audit attempts. Rendering allows up to 300 seconds; configure the deployment's request timeout accordingly. Existing clinic permissions, consent flow, upload limits, no-store responses and download-only behavior remain in place.

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
Las fuentes clínicas se ajustan completas y los subtítulos se colocan después de
la imagen visible, sin cubrirla ni recortarla.


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
