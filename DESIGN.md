# Dental Studio — sistema de diseño

## Dirección

Editor creativo de trabajo diario, más cercano a un estudio de contenido que a un dashboard administrativo. Se basa en la filosofía Operate + Distill de [Impeccable](https://github.com/pbakaus/impeccable): interfaces claras, controles familiares, una acción primaria y espacio dedicado al material real.

## Estructura

- Navegación superior con rutas independientes: `/dashboard/crear`, `/dashboard/pendientes`, `/dashboard/historial` y `/dashboard/conexiones`.
- En Crear, composición de dos columnas compactas: configuración (hasta 490px) y vista previa (hasta 360px). En móvil, se apilan.
- La vista previa siempre está presente pero nunca ocupa media pantalla: proporción 4:5 y altura limitada. Antes de seleccionar fotografía muestra un estado vacío instructivo; después utiliza el render real del backend.
- Controles de ajuste de foto se muestran únicamente al seleccionar una imagen; zoom y posición quedan dentro de un detalle desplegable.
- Botón principal para generar propuesta; la aprobación sigue en Pendientes.

## Identidad

- Lienzo `#f4f7f5`, superficies blancas.
- Verde profundo `#116d60` para acciones, verde oscuro para titulares, bordes discretos.
- Tipografía Source Sans 3 y escala operativa. Sin gradientes decorativos, fondos beige grandes, bloques repetidos ni tarjetas anidadas.
- Formulario estrecho y legible; controles consistentes, indicador de selección claro y enfoque accesible.
- CSS consolidado en un único sistema de estilos de Studio: se eliminaron los bloques acumulados de overrides de versiones anteriores.

## Límites

La etapa afecta solo al frontend y el CSS. No modifica Prisma, Grok, los permisos de fotografías, los datos de publicaciones ni Meta. Una vista previa no equivale a una publicación confirmada.

## Pendiente

El propietario decidió aplazar las pruebas funcionales. Comprobar en el equipo local mediante `npm run build` y revisión real en escritorio/móvil antes de desplegar.
