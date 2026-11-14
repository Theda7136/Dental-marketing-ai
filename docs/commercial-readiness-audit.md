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


## OAuth social por clínica (primera implementación)

- Los endpoints de inicio de Meta y TikTok verifican `connections:manage`, obtienen la clínica y el usuario de la sesión del servidor, generan un `state` aleatorio y guardan una firma HMAC ligada a esa sesión en una cookie temporal HttpOnly.
- Los callbacks exigen la misma sesión, usuario, clínica, proveedor y `state` antes de canjear el código OAuth; se rechaza cualquier discrepancia.
- La asociación de cuentas usa `clinicId` de sesión, actualizaciones condicionadas y creación que rechaza colisiones de unicidad para no reasignar cuentas sociales durante autorizaciones simultáneas.
- `tests/social-oauth-state.test.mjs` cubre estados legítimos, intercambios de sesión, usuario, clínica y proveedor, así como cookies inválidas.
- **Pendiente:** pruebas end-to-end OAuth con dos clínicas y revisión de configuración `META_PAGE_ID` global. La unicidad `Account(provider, providerAccountId)` impide enlazar el mismo usuario de Meta en dos clínicas, incluso para Páginas diferentes; requiere un diseño por Página/activo antes de soportar ese escenario comercial.
- **Pendiente P0:** almacenamiento y entrega de medios por clínica, así como la eliminación segura de la autenticación heredada. No levantar el bloqueo multiempresa.


## Aislamiento de multimedia por clínica

- Los nuevos archivos se guardan bajo `storage/clinics/<clinicId>/posts/<postId>.<ext>` o `clinics/<clinicId>/posts/<postId>.<ext>` en S3/R2.
- El lector permite recuperar archivos antiguos en `storage/posts` o `posts/` **solo** si la clínica es `pilot` y el nuevo archivo no existe. No se realizó una migración destructiva.
- Las URL de publicación incluyen `clinic`, `expires` y `signature`; el HMAC firma conjuntamente clínica, post y vencimiento. Los enlaces anteriores sin parámetro de clínica dejan de ser válidos. Los nuevos enlaces siguen caducando a las 12 horas.
- `/api/media/[id]` obtiene el contexto desde una sesión autorizada o una firma de entrega válida y verifica que el post pertenezca a esa clínica **antes** de leer el archivo.
- Las operaciones de escritura, lectura y borrado reciben `clinicId` explícito; se rechazan componentes de ruta no válidos.
- Pruebas: `tests/media-signature-isolation.test.mjs` y `tests/media-storage-isolation.test.mjs` comprueban firmas cruzadas, aislamiento en disco y compatibilidad solo para `pilot`.
- **Pendiente P0:** ejecutar pruebas reales con S3/R2, verificar descargas de Meta y TikTok y ensayar restauración con datos existentes. No activar acceso multiempresa. Las URL firmadas conceden acceso temporal al fichero al portador del enlace; no son enlaces públicos permanentes ni sustituye eso la autorización del paciente.


## Pruebas integrales de la ruta de medios

- Se incorporó `tests/media-route-isolation.test.mjs` a `npm test`.
- La prueba ejecuta la lógica real de `GET /api/media/[id]` con dobles controlados de sesión, Prisma y almacenamiento: sesión de clínica propia, sesión de clínica ajena, acceso anónimo, enlace firmado por clínica, enlace firmado de otra clínica y post inexistente.
- Se verifica que ninguna petición ajena o inexistente llegue a `readPostMedia`.
- El HMAC real se prueba por separado en `tests/media-signature-isolation.test.mjs`; esta prueba de ruta simula la validación de firma.
- **Hallazgo P0:** `BrandProfile.id` es global con valor `default`. La ruta `/api/brand` usa el mismo identificador con un filtro secundario de clínica; no es compatible con una identidad visual por empresa sin migración de clave.
- **Hallazgo P1:** `META_PAGE_ID` es configuración global y `Account(provider, providerAccountId)` es único entre clínicas; definir selección de Página por clínica antes de soportar diferentes empresas conectadas por un mismo usuario de Meta.
- **Estado:** pruebas creadas y registradas; falta ejecutarlas y validar con SQLite real, almacenamiento S3/R2 y conexiones de Meta/TikTok. Se mantiene el bloqueo de la clínica piloto.


## Identidad de marca por clínica

- Migración `20261113100000_brand_per_clinic`: transforma el registro heredado `BrandProfile(id="default", clinicId="pilot")` en `BrandProfile(id="pilot", clinicId="pilot")` **sin eliminar el logo ni los demás valores**.
- `BrandProfile.clinicId` ahora es único; `GET/POST /api/brand` y los generadores de foto y video buscan por `clinicId`. Los registros nuevos usan un `id` explícito igual al de su clínica.
- `tests/brand-clinic-migration.test.mjs` comprueba con SQLite la preservación del piloto, la independencia de marca y el rechazo de duplicados; se incorporó a `npm test`.
- La migración requiere copia de seguridad y `prisma generate` **antes** de ejecutar TypeScript. Ver las instrucciones de actualización en README.
- No se habilitó el acceso multiempresa. Pendiente: selección de Páginas Meta por clínica, validación end-to-end y despliegue persistente.


## Selección de Página Meta por clínica

- Se añadió entrada opcional para ID de Página de Facebook en `AccountConnector`.
- El ID seleccionado viaja asociado al `state` OAuth y la sesión de clínica (cookie HttpOnly y HMAC); el callback solo admite la Página si la API Meta la devuelve entre las autorizadas.
- La cuenta Meta usa `providerAccountId = page.id` y conserva el token de Página e Instagram. La migración `20261113110000_meta_page_identity` actualiza el ID interno de las conexiones anteriores del piloto sin reemplazar los tokens.
- Tras conectar una Página, se descartan las otras cuentas Facebook de esa misma clínica. El índice único `Account(provider, providerAccountId)` impide que una Página pertenezca a dos clínicas, pero permite que un administrador conecte Páginas diferentes.
- `META_PAGE_ID` sigue funcionando como valor predeterminado **solo para el piloto**. El operador puede sobrescribirlo con la Página elegida.
- `tests/meta-page-identity-migration.test.mjs` comprueba preservación de credenciales, páginas diferentes para clínicas distintas y rechazo de una Página duplicada.
- **Pendiente P0:** pruebas OAuth reales con dos clínicas; la selección requiere conocer el ID numérico de la Página y no proporciona aún un listado interactivo desde Meta. Se mantiene deshabilitado el acceso multiempresa.
