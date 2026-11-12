# Dental Studio — sistema visual

## Dirección

Dental Studio tiene una identidad editorial cálida y propia, distinta del lenguaje de Auditor Inteligente. El producto es un **estudio de contenido odontológico**: el material creativo y su vista previa son protagonistas, pero los controles deben seguir siendo precisos, accesibles y fáciles de usar.

Referencia: [Impeccable](https://github.com/pbakaus/impeccable), especialmente sus criterios de `Operate`, `critique`, `distill`, `layout`, `polish` y `adapt`. Este diseño se implementa directamente en React/CSS; no se afirma que la ejecución automatizada de Impeccable haya auditado la página protegida por Basic Auth.

## Identidad

- Marfil cálido `#f8f5ef` como lienzo general y blanco suave `#fffdfa` para edición.
- Terracota `#a64e35` en acciones creativas, navegación activa y foco; verdes oscuros para títulos y estados clínicos donde el significado lo requiera.
- Vista previa en superficie cálida `#efe6da`, imagen con `object-fit: contain` para conservar su encuadre.
- Fuente Source Sans 3 en interfaz operativa, títulos sobrios y claros.
- Bordes finos, radios moderados (7–13px), sin gradientes en botones principales ni tarjetas decorativas superpuestas.

## Navegación

Las cuatro rutas son independientes y muestran únicamente las funciones correspondientes:

- `/dashboard/crear`: formulario de foto/video/guion y gran escenario de previsualización de fotografía en vivo
- `/dashboard/pendientes`: revisión de publicaciones y aprobación
- `/dashboard/historial`: resultados previos y verificación de entregas
- `/dashboard/conexiones`: vínculo con cuentas Meta

La navegación es horizontal en escritorio y desplazable en móvil. `/dashboard` conserva compatibilidad como alias de creación.

## Composición de Crear

En escritorio, se presentan dos zonas:
1. **Preparar**: formulario moderadamente estrecho para lectura y configuración.
2. **Visualizar**: escenario de previsualización; sin foto, mensaje de orientación, con foto la representación 4:5 generada por el servidor.

La vista previa utiliza el mismo procesamiento que la creación de la publicación. No es una emulación exacta de la interfaz de Facebook ni Instagram.

En pantallas pequeñas, las áreas se apilan en orden natural. Los controles avanzados de recorte se mantienen plegados hasta necesitarlos.

## Límites

- No inventar diagnósticos, beneficios ni resultados clínicos.
- No procesar fotos identificables con xAI sin autorización.
- No alterar la semántica de Meta ni marcar resultados inciertos como publicados.
- No modificar la base de datos ni las publicaciones existentes durante una fase visual.
- Mantener estados de foco, controles accesibles, mensajes claros y `prefers-reduced-motion`.

## Validación pendiente

Por solicitud del propietario, las pruebas funcionales y la inspección del resultado renderizado siguen pendientes. La implantación se encuentra en la rama `feature/safe-content-review`.
