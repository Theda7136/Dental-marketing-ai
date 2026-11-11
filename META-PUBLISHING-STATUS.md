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
