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
