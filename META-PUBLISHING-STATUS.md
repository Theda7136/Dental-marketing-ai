# Meta Publishing 2.0 — primera fase

## Cambios

Cada propuesta guarda un estado independiente por red, su identificador en Meta y el último error.

- `PENDING`: todavía no se ha intentado publicar en esa red.
- `IN_PROGRESS`: solicitud iniciada; no debe repetirse sin comprobación externa.
- `SUCCEEDED`: Meta devolvió un identificador de publicación y quedó guardado.
- `UNKNOWN`: hubo una interrupción o error y no podemos descartar que Meta haya publicado.

La publicación de una red se reclama en SQLite antes de llamar a Meta. Un estado `IN_PROGRESS`, `SUCCEEDED` o `UNKNOWN` bloquea nuevos envíos automáticos a esa misma red.

## Migración local

Antes de migrar, detén `npm run dev` y realiza un respaldo de `prisma/dev.db` si existe. Luego ejecuta:

```powershell
npx prisma migrate deploy --schema .\prisma\schema.prisma
npm run build
npm run dev
```

No ejecutes `prisma migrate reset`: borra registros. La migración añade columnas sin eliminar las publicaciones existentes. Como los posts antiguos marcados como publicados no tienen IDs externos registrados, se marcan `UNKNOWN` para impedir una republicación accidental.

## Verificación sin publicar contenido real

1. Comprueba que el dashboard abre, carga las propuestas y permite editar los textos pendientes que aún no se han enviado a ninguna red.
2. Confirma que `Aprobar y publicar` muestra una confirmación antes de ejecutar la publicación.
3. Revisa la estructura de la base de datos y sus columnas nuevas.
4. Valida la publicación real solo con contenido explícitamente autorizado, y posteriormente comprueba en Meta que no haya duplicados.

## Limitaciones de esta fase

- No hay reconciliación automática con la API de Meta ni una acción de reintento selectivo todavía.
- Los estados desconocidos requieren verificación manual antes de recuperar la publicación.
- Una confirmación de recepción de Reel por Meta no demuestra que haya terminado su procesamiento.
- El estado general `PUBLISHED` se conserva cuando al menos una red confirma la publicación; el detalle por red permite distinguir resultados parciales.
- No hay pruebas automatizadas de integración con Meta todavía.

## Segunda fase: publicación selectiva

El panel permite publicar **únicamente en una red cuyo estado siga siendo `PENDING`** mediante el botón «Publicar solo en Facebook» o «Publicar solo en Instagram». Está disponible en la cola cuando hay una entrega parcial y, para propuestas publicadas, en «Historial de publicaciones».

- `SUCCEEDED`: nunca se reenvía automáticamente; el identificador de Meta aparece en el historial.
- `IN_PROGRESS` o `UNKNOWN`: bloqueado. Debe comprobarse directamente en Meta antes de decidir cualquier recuperación manual.
- `PENDING`: puede enviarse explícitamente a esa red con confirmación previa. No activa el envío a otras plataformas.
- Si Instagram no está vinculado, no podrá publicarse hasta conectarlo, aunque la propuesta conserve `PENDING` en esa red.

La interfaz vuelve a consultar `/api/posts` después de cada intento, incluso cuando falle, para mostrar los estados persistidos. No existe todavía conciliación automática ni un botón para convertir estados inciertos a pendientes; esa operación requiere definir una verificación segura de Meta.

### Comprobaciones recomendadas

1. Ejecuta `npm run build` antes de probar la pantalla.
2. Verifica que los estados de Facebook e Instagram aparecen en los registros.
3. Abre «Historial de publicaciones» y comprueba que aparecen los identificadores de publicaciones confirmadas.
4. Revisa que los registros con `UNKNOWN` o `IN_PROGRESS` no tengan botones de reenvío para esa misma red.
5. No hagas pruebas de publicación real con fotos clínicas sin consentimiento ni contenido autorizado.

## Tercera fase: verificación manual documentada

Las publicaciones con estado `UNKNOWN` o `IN_PROGRESS` permiten registrar una comprobación manual por cada red desde el Historial de publicaciones.

Se guardan por separado:
- Resultado observado: `FOUND` (encontrada), `NOT_FOUND` (no encontrada), `UNCERTAIN` (sin conclusión).
- Evidencia o descripción breve de la consulta, hasta 1000 caracteres, sin información personal de pacientes.
- Fecha de la comprobación.

**Importante:** una comprobación manual, incluso `NOT_FOUND`, **no modifica** `facebookStatus`/`instagramStatus` ni habilita un reintento. No encontrar una publicación en una búsqueda manual no garantiza que Meta no la haya recibido. El desbloqueo requiere un futuro procedimiento de conciliación más robusto.

Antes de iniciar la app después del pull, respalda SQLite y aplica la nueva migración:

```powershell
if (Test-Path prisma/dev.db) { Copy-Item prisma/dev.db prisma/dev.db.backup }
npx prisma migrate deploy --schema .\prisma\schema.prisma
npm run build
npm run dev
```

No uses `prisma migrate reset`. El registro manual **no ejecuta solicitudes de lectura contra Meta**; documenta únicamente la revisión realizada por la clínica.

## Cuarta fase: consulta de solo lectura a Meta

Desde el historial, cuando existe un identificador confirmado de publicación (`facebookPostId` o `instagramPostId`), el personal puede pulsar «Comprobar ID en Facebook/Instagram». El servidor consulta `GET /{object-id}?fields=id` utilizando el token privado de Meta y un tiempo límite de 15 segundos.

- Solo indica si Meta devuelve el mismo ID bajo los permisos actuales; **no demuestra visibilidad pública ni procesamiento completo de un Reel**.
- Respuestas 403, 404, errores de permisos, fallos de red o tokens vencidos se consideran **inconclusos**, nunca prueba de ausencia.
- No se generan publicaciones ni se modifican los estados de entrega de ninguna red.
- Los registros históricos sin ID de Meta permanecen en revisión manual, con el envío bloqueado.

Para validar: `git pull origin feature/safe-content-review`, `npm run build`, `npm run dev`. No hace falta ejecutar una migración adicional para esta consulta. Verifica en «Historial de publicaciones» los botones únicamente en registros con ID de Meta.

## Quinta fase: filtros de historial

El Historial de publicaciones puede filtrarse en el navegador por plataforma con actividad (Facebook, Instagram o todas) y resultado (al menos una red confirmada sin estados inciertos, parcial, requiere verificación, descartada o todos). La pantalla muestra el número de registros filtrados y un resumen por propuesta que distingue confirmación total, parcial y resultados inciertos.

Estos filtros **no consultan ni modifican Meta**, no cambian la base de datos y no habilitan un reenvío de publicaciones ya confirmadas. Los controles de verificación manual, consulta de identificador y envío explícito a una red `PENDING` permanecen en el historial.

Verificación local: `git pull origin feature/safe-content-review`, `npm run build` y `npm run dev`. No hay migración de datos en esta fase.

## Sexta fase: pruebas automatizadas de política de envío

La política conservadora se centralizó en `src/lib/metaDeliveryPolicy.mjs`. Las acciones del dashboard y el publicador de Meta usan esa política para determinar si una plataforma sigue elegible antes de intentar el envío.

Ejecuta:

```powershell
npm test
npm run build
```

Los tests (`tests/meta-delivery-policy.test.mjs`) verifican que:
- Solo `PENDING` permite envíos.
- `SUCCEEDED` no se puede reenviar aunque la otra red esté pendiente.
- `UNKNOWN` y `IN_PROGRESS` requieren conciliación y bloquean reintentos.
- La publicación inicial y la edición de texto exigen que ambas redes sigan sin intentos.
- Los estados inesperados se bloquean por defecto.

Son **pruebas unitarias de las decisiones de seguridad**, no una simulación de todas las llamadas de Meta, ni una garantía de ausencia de duplicados ante caídas externas o carreras complejas. Todavía hacen falta pruebas con dobles de `fetch`, simulación de concurrencia SQLite y pruebas de integración en entorno de Meta separado antes de producción.

## Séptima fase: pruebas de integración simuladas

`npm test` ejecuta ahora dos conjuntos: política de envío e integración simulada del publicador real.

La segunda batería (`tests/meta-publishing-integration.test.mjs`) transpila `src/lib/metaPublish.ts` en memoria con TypeScript y sustituye sus dependencias de Prisma, URL de medios y `fetch` mediante dobles de prueba. No realiza ninguna solicitud de red ni utiliza tokens de la clínica.

Escenarios cubiertos:
- Un envío de Facebook confirmado no se repite en una segunda llamada.
- Una conexión interrumpida después del intento deja `UNKNOWN` y bloquea nuevas publicaciones.
- Un fallo en Instagram permite que Facebook continúe y conserva el resultado parcial.
- El envío selectivo a Instagram no repite una publicación anterior de Facebook.
- Dos solicitudes simultáneas por una publicación pendiente solo reclaman un envío.

Ejecuta `npm test` y `npm run build`. Estas pruebas simulan la semántica de la actualización condicional de Prisma en memoria; no sustituyen pruebas con SQLite real, reinicios de proceso ni verificaciones de extremo a extremo en una cuenta de prueba de Meta.

## Octava fase: SQLite real y recuperación tras reconexión

`npm test` incorpora `tests/meta-sqlite-persistence.test.mjs`, que crea una base **SQLite temporal aislada** con un esquema de publicación equivalente al modelo Prisma utilizado por el módulo. No abre ni modifica `prisma/dev.db` de la clínica.

Se prueban cuatro escenarios:
- Dos clientes de Prisma intentan reclamar a la vez la misma publicación: solo una actualización condicional puede ganar.
- Un estado `IN_PROGRESS` sigue bloqueado al cerrar y volver a conectar un cliente Prisma.
- Un identificador `SUCCEEDED` de Facebook persiste mientras Instagram permanece elegible si está `PENDING`.
- Una comprobación manual `NOT_FOUND` no desbloquea un estado `UNKNOWN`.

La base temporal se elimina después de las pruebas. No se realizan llamadas a Meta ni se usan tokens reales.

Comprobación: `npm test` seguido de `npm run build`. Estas pruebas validan SQLite real y reconexión, **no** simulan la terminación forzada de un proceso del sistema operativo ni todas las variantes de errores de SQLite. Antes de un piloto comercial siguen siendo necesarias pruebas de Meta en un entorno separado y un plan de copias de seguridad.

## Incidencia local: Meta no puede descargar imágenes desde localhost

La autenticación OAuth sí funciona en `http://localhost:3000`, pero el endpoint `/api/media/:id` debe ser descargable desde los servidores de Meta para publicar por URL.

El publicador utiliza ahora `META_PUBLIC_MEDIA_URL` exclusivamente para construir enlaces firmados del archivo. Si no está definida, utiliza `NEXT_PUBLIC_APP_URL`. **Antes de reclamar el estado de la red**, rechaza orígenes HTTP y destinos locales (`localhost`, `127.0.0.1`, `::1`). Esto evita convertir nuevos borradores en `UNKNOWN` por una URL local que Meta no puede visitar.

### Prueba con un túnel HTTPS temporal

1. Conserva `NEXT_PUBLIC_APP_URL=http://localhost:3000` y `META_REDIRECT_URI=http://localhost:3000/api/auth/meta/callback`. No es necesario cambiar el callback de OAuth.
2. Ejecuta `npm run dev` en una terminal.
3. Instala `cloudflared` en Windows desde su fuente oficial y, en otra terminal, ejecuta `cloudflared tunnel --url http://localhost:3000`.
4. Copia el origen `https://...trycloudflare.com` que muestra `cloudflared`. Introduce en `.env` una línea `META_PUBLIC_MEDIA_URL=https://...trycloudflare.com`. No añadas rutas, barras finales ni parámetros.
5. Reinicia `npm run dev` manteniendo abierto el túnel. Verifica desde una red externa que la URL firmada de una **propuesta de prueba** responda `200` y que el archivo sea una imagen. Nunca compartas enlaces firmados, tokens o fotografías de pacientes.

Los túneles rápidos no son aptos para producción y cualquiera con el enlace conoce una vía hacia el servidor; el panel mantiene Basic Auth y el contenido requiere firma. Usa material totalmente ficticio, no clínico, durante el piloto.

**No cambies ni desbloquees a mano** publicaciones anteriores con `UNKNOWN`: primero revisa los registros y confirma el estado real. Un intento previo podría haberse procesado aunque la interfaz no lo muestre. La nueva validación aplica únicamente a solicitudes futuras.

`npm test` ahora también cubre el rechazo de URL local antes de reclamar el estado.

## Verificación previa de descarga HTTPS

El dashboard muestra «Comprobar acceso HTTPS de imagen» en las propuestas de fotografía. Esta acción no publica nada en Facebook ni altera estados de entrega.

Requisitos:
- `META_PUBLIC_MEDIA_URL=https://<subdominio>.trycloudflare.com` en `.env` (solo para el túnel de pruebas).
- `DENTAL_MEDIA_SIGNING_SECRET` de al menos 32 caracteres.
- Next.js y el túnel activos, apuntando al mismo puerto.

El servidor genera una URL firmada, solicita la imagen por HTTPS y verifica HTTP 200, `Content-Type: image/*` y presencia de bytes. No revela la firma en el navegador, no sigue redirecciones y usa un tiempo límite de 12 segundos. Solo admite hosts `.trycloudflare.com` para esta comprobación local; no debe reutilizarse tal cual como mecanismo genérico de publicación en producción.

Que esta comprobación sea correcta **no garantiza** que Meta acepte la publicación, ni autoriza repetir una publicación anterior con resultado `UNKNOWN`. Para el ensayo de Meta utiliza una fotografía ficticia nueva, con la página de pruebas correctamente conectada.

## Grok: versiones educativa y comercial + visión opcional

Nuevos borradores de fotografía, video y guion generan **dos** propuestas de texto: `educationalCaption` y `commercialCaption`. Se almacena `selectedStyle=EDUCATIONAL` por defecto; el dashboard permite elegir Educativa/Comercial, y guarda la elección en `generatedCaption` antes de publicar. Editar el texto modifica únicamente la variante seleccionada. Los cambios están bloqueados una vez que se ha intentado enviar a una red.

Las fotos incluyen una casilla opcional «Analizar imagen con Grok Vision». Si se activa, el servidor genera una imagen JPEG reducida (768×768 máximo) y la envía a xAI para obtener una descripción **solo visual y no diagnóstica**; no pide un diagnóstico ni resultados clínicos. Sin seleccionar la casilla, no se envían imágenes a Grok: el copy se basa en el procedimiento y las notas.

Recomendaciones:
- Solo utilizar imágenes sin datos identificables y con autorización para procesarlas por un servicio externo; no subir casos de pacientes para probar nuevas funciones.
- Mantener la revisión clínica humana de ambos textos, especialmente la versión comercial.
- Las nuevas columnas se añaden mediante una migración aditiva. Los registros anteriores continúan sin variantes y conservan su texto.
- La generación de dos versiones implica dos llamadas al modelo de texto y aumenta el consumo de API.
- Esta fase no cambia la publicación en Meta ni desbloquea propuestas cuyo estado sea `UNKNOWN`.

Verificación local tras `git pull`:

```powershell
if (Test-Path prisma/dev.db) { Copy-Item prisma/dev.db prisma/dev.db.backup }
npx prisma migrate deploy --schema .\prisma\schema.prisma
npm test
npm run build
npm run dev
```

Prueba una propuesta nueva con imagen **ficticia**, sin activar visión primero. Confirma que ambas versiones cambian al seleccionar cada estilo, que pueden editarse individualmente y que no se publica nada antes de aprobar manualmente. Después, prueba visión solo con una imagen sintética.

## Flujo de recuperación para publicación sin confirmación (2026-11-12)

El bloqueo por `UNKNOWN` se mantiene hasta que alguien revise la Página de Facebook o cuenta de Instagram. Si la publicación no existe, el operador puede:

1. En la tarjeta, abrir «Registrar comprobación».
2. Elegir «No encontré la publicación» y escribir dónde y cuándo revisó la Página/Meta Business Suite, sin datos de pacientes.
3. Guardar la comprobación y seleccionar «Habilitar un reintento tras comprobar Meta». El backend exige registro reciente (máximo 30 minutos), ausencia de ID guardado y `UNKNOWN`, y limita la autorización a un solo reintento.
4. Comprobar acceso HTTPS de la foto; usar «Publicar solo en Facebook» o «Publicar solo en Instagram», según la red autorizada. El botón «Aprobar y publicar» para ambas redes permanece bloqueado.

**Precaución:** no encontrar un post no prueba de manera absoluta que Meta no lo haya aceptado. Esta recuperación es una decisión manual y auditada, no una garantía de idempotencia; exige confirmación expresa y nunca publica automáticamente.

Hay una migración aditiva: `20261112130000_manual_meta_retry_audit`. No se eliminan borradores, IDs ni evidencias. Las recuperaciones registran contador y fecha de autorización.

## UX de generación (2026-11-12)

El selector «Enfoque de la propuesta» aparece **antes** de adjuntar archivo y de pulsar «Generar propuesta». Grok crea variantes Educativa/Comercial y selecciona como `generatedCaption` la elegida desde el formulario. La tarjeta permite cambiarla mientras no haya habido envíos.

Grok Vision se integra al envío de fotografías mediante xAI Responses API `grok-4.7`. No hay opción técnica de habilitar/deshabilitar Vision; para procesar una imagen es obligatorio marcar la casilla de consentimiento específico (sin datos identificables). El backend también valida esa condición. El uso de fotos reales requiere controles de privacidad y autorizaciones adicionales. Videos y guiones no hacen análisis de imagen.
