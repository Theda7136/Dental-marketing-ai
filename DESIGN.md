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

## Fase de herramientas creativas y marca (2026-11-12)

1. **Carga de archivos**: el editor de imagen y video muestra archivo elegido, miniatura (imagen), peso MB y botón Reemplazar. El input conserva el nombre de campo `photo` para mantener compatibilidad con el backend.
2. **Reproductor local**: los videos seleccionados pueden reproducirse en la vista previa mediante una URL temporal del navegador. **No** es una representación del archivo renderizado final con ajustes de FFmpeg; esta vista muestra el original. Las URLs temporales se liberan al cambiar el archivo.
3. **Fotografía**: zoom, posición horizontal/vertical y restablecimiento están ubicados en el panel de vista previa. El formulario conserva únicamente estilo, encuadre y fondo; la previsualización en 4:5 usa el endpoint existente.
4. **Confirmación de creación**: al guardar una propuesta se muestra mensaje verde y enlace real a `/dashboard/pendientes`.
5. **Identidad de marca**: en Conexiones aparece el editor de nombre, color, tipografía y logotipo con vista previa. Datos en tabla `BrandProfile`, migración aditiva `20261112163000_brand_settings`. El logo se normaliza por Sharp, se limita a 2 MB de entrada y aproximadamente 400 kB resultantes. **No** se sobreimprime automáticamente en imágenes clínicas ni altera material previamente publicado.

Configuración en Windows tras actualizar:
```powershell
if (Test-Path prisma/dev.db) { Copy-Item prisma/dev.db prisma/dev.db.backup }
npx prisma migrate deploy --schema .\prisma\schema.prisma
npx prisma generate
npm run dev
```

Las pruebas completas continúan pendientes por elección del propietario. Antes del despliegue es obligatorio comprobar que el build compila, revisar la carga de imágenes/videos, la reproducción y el formulario de marca.

## Herramientas creativas (noviembre de 2026)
- Carga con miniatura del archivo, tamaño en MB y acción «Reemplazar».
- Vista previa de video local con controles de reproducción; no se publica ni se sube a Meta al previsualizar.
- Edición de foto y ajustes de zoom/posición junto a la vista previa, sin controles duplicados en el formulario.
- Confirmación de guardado con acceso a `/dashboard/pendientes`.
- Identidad de marca editable en `/dashboard/conexiones`: nombre, color, tipografía y logotipo JPG/PNG/WebP. El perfil se guarda en SQLite y se muestra en una muestra de marca. No modifica publicaciones previas ni incrusta automáticamente logotipos sobre fotografías clínicas.

Migración aditiva: `20261112163000_brand_settings`. Antes de utilizar el editor de marca hay que ejecutar `npx prisma migrate deploy` y `npx prisma generate`. Las pruebas de funcionamiento permanecen pendientes por decisión del propietario.

## Nuevas herramientas del estudio

- Carga de archivo: tarjeta compacta con miniatura local, nombre, tamaño, formato y reemplazo. Las URLs temporales de imagen y video se revocan al cambiar de archivo.
- Video: reproducción local con controles en el panel derecho antes de generar; no es todavía la exportación procesada por FFmpeg.
- Fotografía: previsualización renderizada en servidor a 4:5 con zoom y movimiento horizontal/vertical por deslizadores o arrastre; el formulario conserva estilo, fondo y tipo de recorte.
- Al generar: mensaje de éxito en el editor y enlace directo a `/dashboard/pendientes`. Un error no muestra confirmación de guardado.
- Marca: nuevo bloque en `/dashboard/conexiones`. Guarda el nombre, color, familia tipográfica y un logo optimizado, con una representación visual de identidad. Estos ajustes son para uso futuro; todavía **no se aplican automáticamente a fotografías de pacientes** ni publicaciones anteriores.

### Migración necesaria

Antes de iniciar con la nueva configuración de marca, respaldar `prisma/dev.db` y ejecutar:

```powershell
git pull origin feature/safe-content-review
if (Test-Path prisma/dev.db) { Copy-Item prisma/dev.db prisma/dev.db.backup }
npx prisma migrate deploy --schema .\prisma\schema.prisma
npx prisma generate
npm run build
npm run dev
```

La nueva tabla `BrandProfile` es aditiva. No realizar `migrate reset`, `db push --force-reset` ni eliminar `dev.db`.

Las pruebas automáticas siguen pendientes a petición del propietario. La apariencia y el funcionamiento aún no se han validado en su equipo.

## Mejoras del editor — archivos y branding

- Carga de imágenes y videos con miniatura local, nombre, peso, tipo y reemplazo en el mismo control.
- Vista previa de videos mediante `<video controls>` y URL local del navegador; no es una simulación del render final por FFmpeg ni de Meta.
- Los controles de posición y zoom están asociados al escenario fotográfico 4:5 y solo aparecen con fotografía seleccionada. Incluyen botón Restablecer y arrastre con puntero; la vista final sigue dependiendo del renderer del servidor.
- Tras crear una propuesta, se muestra una confirmación con enlace directo a `/dashboard/pendientes`.
- En `/dashboard/conexiones` se agregó identidad de marca: nombre, color principal, tipografía predefinida y logotipo rasterizado. `/api/brand` usa la autenticación actual y almacena los datos en SQLite (`BrandProfile`).
- La marca configura la identidad interna del estudio y una tarjeta demostrativa. **No se imprime automáticamente sobre material clínico o publicaciones existentes**; el uso de plantillas gráficas de marca para nuevas piezas requiere una fase independiente de aprobación de contenidos.

### Actualización local

Como se añadió un modelo Prisma, hacer copia de seguridad de `prisma/dev.db`, aplicar `npx prisma migrate deploy`, generar el cliente y compilar cuando se reanuden las pruebas. No ejecutar `prisma migrate reset`.
