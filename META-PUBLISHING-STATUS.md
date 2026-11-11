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
