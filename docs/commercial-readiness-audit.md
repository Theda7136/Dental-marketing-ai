# Preparación comercial — auditoría inicial

Estado: piloto de una sola clínica. **No habilitar nuevas clínicas todavía.**

## Hallazgos confirmados

| Prioridad | Hallazgo | Evidencia en código | Criterio de cierre |
| --- | --- | --- | --- |
| P0 | El acceso está restringido a `pilot` | `src/lib/studioAccess.ts`, `src/proxy.ts` | Mantener restricción hasta verificar aislamiento de todos los endpoints y trabajos diferidos |
| P0 | Publicación Meta usa `clinicId: "pilot"` | `src/lib/metaPublish.ts` | Cada envío obtiene la clínica autorizada y consulta cuentas y posts solo de esa clínica |
| P0 | Publicación TikTok usa `clinicId: "pilot"` | `src/lib/tiktokPublisher.ts` | El acceso a cuentas, tokens, publicaciones y seguimiento de estados queda aislado por clínica |
| P0 | Endpoint de medios usa `clinicId: "pilot"` y autenticación heredada | `src/app/api/media/[id]/route.ts`, `src/proxy.ts` | Medios privados por sesión y clínica; URLs firmadas de alcance limitado, auditadas para acceso público de plataformas |
| P0 | Almacenamiento de medios no contiene prefijo de clínica | `src/services/mediaStorage.ts` | Claves por clínica y migración compatible con archivos del piloto |
| P1 | Esquema usa IDs globales de marca y unicidad global de cuentas | `prisma/schema.prisma` (`BrandProfile.id`, `Account(provider, providerAccountId)`) | Migración hacia claves y restricciones alineadas a tenencia multiempresa |
| P1 | SQLite de piloto y archivos locales por defecto | `prisma/schema.prisma`, `src/services/mediaStorage.ts` | Base de datos y objeto multimedia persistentes, migración, restauración ensayada |
| P1 | Consultas SQL registradas explícitamente | `src/lib/prisma.ts` | **Mitigado:** log de consultas deshabilitado |
| P1 | Tokens OAuth almacenados en base de datos | `prisma/schema.prisma`, `src/lib/metaPublish.ts` | Revisar cifrado, rotación, privilegios y redacción de errores/logs |
| P1 | Firma de medio depende de ID y expiración | `src/lib/mediaSignature.ts` | Validar firma, expiración, revocación y pertenencia a clínica en todos los casos de uso |
| P2 | Estadísticas sociales pueden referir publicaciones eliminadas | `src/app/api/performance/facebook/route.ts` | Estados reconciliados sin borrar auditoría histórica |

## Orden recomendado

1. Definir contratos de acceso por clínica para sesión, publicaciones, cuentas, medios y tareas asíncronas. Escribir pruebas con dos clínicas y usuarios diferentes; verificar acceso denegado cruzado.
2. Refactorizar rutas de publicación y sus dependencias para recibir contexto de clínica **del servidor**, nunca de parámetros suministrados por el navegador.
3. Migrar almacenamiento y esquema de datos con compatibilidad para `pilot`; ensayar restauración y reversión.
4. Revisar accesos OAuth de Meta/TikTok y credenciales; verificar conexión y publicación desde una clínica no piloto en entorno de pruebas.
5. Solo entonces retirar el bloqueo multiempresa de `studioAccess` y `proxy` y ejecutar prueba end-to-end con dos clínicas independientes.
6. Preparar infraestructura, respaldo, observabilidad sin datos clínicos, soporte, documentación legal y facturación.

## Reglas del lanzamiento

- No publicar material clínico sin revisión y autorizaciones pertinentes.
- No copiar tokens ni imágenes de pacientes en logs, capturas, tickets o datos de prueba.
- No inferir «publicación borrada» de cualquier error aislado de Meta; verificar estado con evidencia suficiente.
- No activar cobros o altas autoservicio hasta completar los controles P0 y las pruebas end-to-end.

Esta auditoría es una revisión inicial por lectura de código, no una prueba de penetración ni una certificación de cumplimiento.


## Avance de implementación

- Se añadieron pruebas de aislamiento de sesiones con dos clínicas distintas en `tests/clinic-session-isolation.test.mjs` y se incorporaron a `npm test`.
- Se comprueban membresías por clínica, ausencia de membresía en la clínica de la sesión, estado de usuario y clínica, sesiones vencidas o revocadas y rechazo de altas de sesiones con membresía ajena.
- La generación de videos ahora exige `clinicId` explícito en vez de usar `"pilot"` por defecto.
- Estas pruebas usan dependencias simuladas: falta ejecutar validación con SQLite real y dos clínicas de prueba antes de retirar el bloqueo global.
- **Pendiente P0:** publicar y consultar estados de Meta/TikTok solo mediante una sesión o contexto de clínica fiable, y eliminar `clinicId: "pilot"` de los publicadores tras incorporar pruebas de integración. **No retirar todavía el bloqueo de `src/proxy.ts` ni `src/lib/studioAccess.ts`.**

## Aislamiento inicial de publicación social

- `publishToMeta(post, clinicId, network?)` exige un contexto de clínica proporcionado por la acción autenticada del servidor y filtra cuenta, post y actualizaciones por ese identificador.
- `publishToTikTok(postId, clinicId, ...)` y `refreshTikTokPostStatus(postId, clinicId)` filtran la publicación y sus cambios por clínica.
- La obtención, renovación y consulta de capacidades de TikTok usa la clínica de la sesión; el token no se selecciona globalmente.
- Se añadieron casos de prueba con clínicas distintas y cuentas sociales ajenas en `tests/meta-publishing-integration.test.mjs`, `tests/tiktok-publishing.test.mjs` y `tests/tiktok-account-isolation.test.mjs`.
- **Pendiente P0:** revisar los callbacks OAuth, que aún tienen referencias fijas a `pilot`; también el acceso y el almacenamiento de medios. No quitar el bloqueo multiempresa.
- Las pruebas de integración usan dobles simulados para redes; verificar con dos clínicas reales antes de abrir el producto.
