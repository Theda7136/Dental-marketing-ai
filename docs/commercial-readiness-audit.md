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
