# Dental Studio — sistema de diseño

## Dirección
Workspace clínico profesional: sereno, legible, seguro y rápido. Interfaz de operación, no landing page. Inspirado en principios de Impeccable (Operate, distill, layout, typeset, adapt, polish), adaptados al producto existente.

## Identidad
- Fondo neutro cálido `#f5f7f5`; superficies blancas.
- Tinta `#163b36`; texto secundario `#526963`; acento `#116f64`.
- Color de acento reservado para acciones principales y selección; ámbar para advertencias; rojo para errores; verde para confirmaciones.
- Fuente sans legible en toda la interfaz (Source Sans 3 ya presente).
- Radios moderados: 10–16px en paneles y controles; chips compactos.
- Sombras discretas, no neones, degradados decorativos ni tarjetas anidadas.

## Jerarquía
- Navegación lateral en escritorio y horizontal en móvil.
- Encabezado compacto y orientado a tarea.
- Cuenta Meta en sección de estado; creación y aprobación en dos áreas claras.
- Historial y comprobaciones avanzadas secundarios, no competir con publicar.
- Formularios con etiquetas persistentes, 44px como objetivo táctil, mensajes de recuperación precisos.

## Responsividad y accesibilidad
- Escritorio: navegación lateral, formulario y cola en columnas.
- Tablet: secciones apiladas manteniendo navegación.
- Móvil: navegación horizontal y contenido apilado, sin desplazamiento horizontal accidental.
- Foco visible, controles semánticos, estados con texto además de color, contraste legible, reduced motion.

## Guardrails
- No introducir métricas o información clínica inventada.
- No mostrar como confirmada una publicación solo por haberse solicitado.
- No tratar una fotografía de paciente como decoración.
- El diseño no cambia la capa de datos, el procesamiento de imagen ni la API de Meta.

## Referencia
`pbakaus/impeccable` (Apache 2.0). La implementación del producto aplica sus criterios de diseño, sin copiar componentes ni afirmar que el detector se ejecutó.

## Navegación revisada — páginas independientes

Dental Studio emplea una navegación superior horizontal, deliberadamente distinta del dashboard de Auditor Inteligente. Cada enlace abre una ruta real:

- `/dashboard/crear`: formulario completo de creación y ajustes visuales
- `/dashboard/pendientes`: cola de propuestas, revisión de texto y aprobación por red
- `/dashboard/historial`: historial con filtros y comprobación de publicaciones
- `/dashboard/conexiones`: vinculación de Meta y estado de las cuentas

La ruta previa `/dashboard` se conserva como alias de creación para no romper accesos anteriores. La navegación marca la ruta activa con `aria-current="page"`, y el resto de la interfaz conserva el mismo motor de datos y acciones.

La distribución pasa a navegación horizontal y superficie de trabajo principal, con el formulario ancho y las tarjetas de aprobación más legibles. En móvil, las rutas quedan en una barra desplazable horizontal.

No se han ejecutado pruebas funcionales en esta fase, conforme a la decisión de posponerlas.
