# Dental Marketing AI

> Panel privado para que una clínica prepare, revise y publique contenido odontológico en redes sociales. El proyecto está en fase piloto para una sola clínica.

## Qué permite hacer

- Crear propuestas para foto clínica, video/Reel e ideas de texto.
- Procesar imágenes y videos desde el servidor antes de mostrarlos en la cola.
- Generar copies, hashtags y llamados a la acción con Google Gemini; Grok es un respaldo opcional para texto.
- Revisar cada propuesta manualmente antes de publicarla.
- Revisar el caso y su texto antes de pulsar «Aprobar y publicar»: esa acción registra la aprobación en SQLite sin formularios de confirmación adicionales.
- Adaptar el texto al canal de publicación: Facebook con tono natural y pocos hashtags, Instagram con copy más breve y hashtags seleccionados. Las fotografías se mantienen en formato feed 4:5, sin recortar datos clínicos.
- Buscar propuestas por procedimiento y consultar Pendientes e Historial en páginas de diez resultados.
- Quitar propuestas de Pendientes o Historial mediante «Quitar del panel» en cualquier estado, archivando el registro sin borrar las publicaciones realizadas en Meta o TikTok ni los datos de auditoría. Un envío ya iniciado puede continuar en la plataforma.
- Conectar una Página de Facebook y, si está vinculada, una cuenta profesional de Instagram.
- Elegir Facebook, Instagram y/o TikTok desde un único control de publicación, sin enviar a redes no seleccionadas y con estado de entrega separado por plataforma.
- Guardar propuestas en SQLite y medios en el disco local o en almacenamiento compatible con S3.

La aplicación no programa publicaciones futuras. La aprobación inicia la publicación inmediata en las redes conectadas.

## Reels e Historias

- **Feed:** fotografías 4:5 para Facebook e Instagram, como antes.
- **Reels:** videos verticales (MP4, MOV o WebM) de hasta 60 segundos, preparados como MP4 1080×1920. También puedes seleccionar una fotografía: se convertirá en un clip vertical silencioso de 7 segundos.
- **Historias:** fotografías y videos verticales en Instagram, con tamaño 9:16 y envío mediante `media_type=STORIES`. La historia fotográfica adapta la imagen sin recortar detalles clínicos.
- **Historias:** el mismo selector permite enviar a Facebook Stories y/o Instagram Stories. Facebook utiliza `photo_stories` o `video_stories`; TikTok no aparece como destino de historias. Cada red registra su propio resultado y los envíos inciertos requieren comprobación antes de repetirlos.
- El panel guarda el destino `FEED`, `REEL` o `STORY` en cada propuesta y mantiene revisión humana y estados de entrega independientes. Las propuestas antiguas se conservan como Feed.
- Una imagen convertida en Reel es un clip estático, no una animación generativa ni una secuencia de varias fotos. Los videos conservan su audio salvo que actives «Silenciar audio original».

## Flujo de publicación

1. El personal selecciona el formato, el procedimiento y el material del caso.
2. El servidor valida los datos y prepara la imagen o el video.
3. Gemini redacta el texto; ante ciertos errores, Grok puede actuar como respaldo si tiene créditos y clave configurada. Los controles clínicos bloquean algunas promesas absolutas o frases de riesgo.
4. La propuesta queda en la cola para revisión humana.
5. Una persona autorizada revisa el material y el copy, y decide si publica.

La IA es una herramienta de redacción, no una fuente de diagnóstico ni una revisión clínica. El odontólogo debe comprobar el contenido antes de compartirlo.

## Tecnologías

- Next.js 16, React 19 y TypeScript.
- Prisma 6 con SQLite para los datos del piloto.
- Google Gemini API para contenido y análisis visual consentido; xAI/Grok como respaldo opcional de texto.
- sharp para preparar imágenes y ffmpeg para procesar videos verticales.
- Meta Graph API para publicar en Facebook Reels, Facebook Photos e Instagram, cuando la cuenta profesional esté vinculada.
- Almacenamiento local por defecto; S3/R2 opcional para medios.

## Requisitos

- Node.js 20.9 o posterior y npm.
- Una clave de Gemini para generar propuestas con IA. Grok es opcional.
- Una aplicación de Meta configurada para conectar la Página, si se probará la publicación social.

Next.js 16 requiere Node.js 20.9 o posterior ([requisitos oficiales](https://nextjs.org/docs/app/getting-started/installation#system-requirements)).

## Inicio local

Desde la carpeta raíz del proyecto:

    npm ci
    if (-not (Test-Path .env)) { Copy-Item .env.example .env }

Edita `.env` en tu equipo y configura las variables que vayas a usar. Después prepara SQLite y el cliente Prisma:

    npx prisma migrate deploy --schema .\prisma\schema.prisma
    npx prisma generate --schema .\prisma\schema.prisma
    npm run dev

Abre `http://localhost:3000`. El nombre de usuario del acceso es `clinica`; la contraseña se define en `DENTAL_APP_PASSWORD` y debe tener al menos 16 caracteres.

SQLite está configurado en el esquema como `file:./dev.db`; no se necesita `DATABASE_URL` para la configuración local estándar.

## Variables de entorno

La plantilla completa está en [`.env.example`](./.env.example). Configura los valores localmente; nunca pegues el contenido de `.env` en chats, capturas o incidencias.

| Variable | Uso |
| --- | --- |
| `DENTAL_APP_PASSWORD` | Contraseña compartida del piloto; mínimo 16 caracteres. El usuario es `clinica`. |
| `GEMINI_API_KEY` | Clave principal privada de Google AI Studio. |
| `GEMINI_MODEL` | Modelo Gemini; por defecto `gemini-3.1-flash-lite`. |
| `XAI_API_KEY` | Clave opcional para el respaldo Grok de texto cuando Gemini tiene errores temporales o de cuota. |
| `META_CLIENT_ID` | ID de la aplicación de Meta. |
| `META_CLIENT_SECRET` | Secreto de la aplicación de Meta; mantenlo solo en el servidor. |
| `META_PAGE_ID` | Opcional. Fija la Página piloto si la cuenta administra más de una. |
| `NEXT_PUBLIC_APP_URL` | URL base de la aplicación. Usa localhost en desarrollo y HTTPS público para que Meta pueda descargar medios. |
| `META_REDIRECT_URI` | Callback OAuth de Meta; debe coincidir exactamente con la URL registrada en la aplicación Meta. |
| `DENTAL_MEDIA_SIGNING_SECRET` | Secreto aleatorio de al menos 32 caracteres para firmar enlaces temporales de medios. |
| `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Opcionales. Si se define almacenamiento S3/R2, completa las tres. |
| `AWS_REGION` | Región de S3; para Cloudflare R2 se usa `auto`. |
| `AWS_S3_ENDPOINT` | Endpoint S3 compatible; requerido para Cloudflare R2. |

Sin configuración S3/R2, los medios se guardan en `storage/posts`. En un servidor con disco efímero, usa almacenamiento persistente antes de depender del sistema.

## Preparación para producción

La guía de infraestructura, seguridad del almacenamiento, respaldo y restauración está en [docs/production-deployment.md](docs/production-deployment.md).

Tras configurar el archivo `.env` del servidor, ejecuta `npm run check:production` para comprobar HTTPS, secretos, S3/R2 y callbacks OAuth. Es una validación de configuración, no un reemplazo de pruebas reales o de respaldos restaurables. La base SQLite continúa usando `prisma/dev.db` y requiere un volumen persistente; el acceso multiempresa permanece bloqueado.

## Respaldo verificado de SQLite

Ejecuta `npm run backup:db` para crear una instantánea local en `backups/sqlite/` y comprobar su integridad. Para proteger los datos frente a un fallo del servidor, debes almacenar una copia cifrada fuera de él y ensayar la restauración. Consulta [la guía de despliegue](docs/production-deployment.md).

## Actualizar base de datos del piloto

Antes de ejecutar nuevas migraciones sobre una clínica existente, detén el servidor y haz una copia de `prisma/dev.db` (y del almacenamiento `storage/` si lo usas).

Desde la raíz del proyecto:

```powershell
Copy-Item .\prisma\dev.db .\prisma\dev.db.backup -ErrorAction Stop
npx prisma migrate deploy --schema .\prisma\schema.prisma
npx prisma generate --schema .\prisma\schema.prisma
npx tsc --noEmit
npm test
npm run build
```

La migración `20261113100000_brand_per_clinic` conserva el nombre, los colores, la tipografía y el logo del piloto, cambia el identificador antiguo de la marca de `default` a `pilot` y garantiza una única identidad de marca por clínica. No se borran publicaciones ni multimedia. No ejecutes la migración si no puedes recuperar la copia de seguridad. Si tu base está en otra ruta, respalda ese archivo en lugar de `prisma/dev.db`.

## Configurar Meta

1. Configura una aplicación de Meta y agrega el callback OAuth, normalmente `http://localhost:3000/api/auth/meta/callback` para desarrollo local.
2. Añade el ID y secreto de la aplicación a `.env`.
3. Desde el panel, conecta la Página. Si administras varias, define `META_PAGE_ID` para seleccionar la Página de la clínica.
4. Si administras varias Páginas, indica el **ID numérico de la Página** en Conexiones antes de conectar Meta. El callback comprueba que Meta realmente te ha autorizado esa Página. Para el piloto, `META_PAGE_ID` sigue sirviendo como valor predeterminado cuando no se indica uno.
5. Para publicar también en Instagram, vincula una cuenta profesional de Instagram a esa Página y concede los permisos solicitados por Meta.
6. Reinicia el servidor después de cambiar `.env`.

Meta debe descargar las fotos y videos por HTTPS para procesarlos. localhost solo es visible desde tu equipo; para una prueba local de publicación hace falta un túnel HTTPS temporal o un despliegue accesible públicamente. Los enlaces firmados de medios vencen después de 12 horas. No publiques esos enlaces ni los guardes en lugares públicos.

La migración `20261113110000_meta_page_identity` cambia el identificador interno de la cuenta Meta desde el administrador hacia el ID de su Página, conservando el token y la vinculación de Instagram del piloto. Respalda `prisma/dev.db` antes de aplicar migraciones.

La revisión de Meta y el modo de la aplicación pueden limitar qué cuentas pueden autorizar o publicar. Revisa también el acceso de la persona autorizante a la Página.

## Configurar TikTok

1. Registra una aplicación en [TikTok for Developers](https://developers.tiktok.com/) y añade **Login Kit** y **Content Posting API**.
2. Solicita los permisos `user.info.basic` y `video.publish`. TikTok debe aprobar los productos y permisos correspondientes.
3. Configura `TIKTOK_CLIENT_KEY` y `TIKTOK_CLIENT_SECRET` en tu archivo `.env`. No compartas estos valores.
4. Registra en Login Kit una URL HTTPS exacta (por ejemplo, `https://dental.example.com/api/auth/tiktok/callback`) y copia ese valor a `TIKTOK_REDIRECT_URI`.
5. Verifica en TikTok el dominio o prefijo desde el cual TikTok descargará las fotografías y videos. Configura `TIKTOK_PUBLIC_MEDIA_URL=https://dental.example.com` y asegúrate de que el mismo servidor pueda ofrecer `/api/media/...` mediante HTTPS. Un túnel `trycloudflare.com` temporal no sustituye un dominio verificado.
6. Abre Dental Studio desde la misma dirección HTTPS del callback y entra a **Conexiones → Conectar TikTok**. El panel requiere autorización Basic y valida un `state` OAuth antes de almacenar tokens en el servidor.
7. En **Pendientes** o **Historial**, selecciona **Preparar publicación TikTok**. Elige la privacidad ofrecida por la cuenta y las opciones de interacción, revisa el texto y pulsa **Publicar en TikTok**.
8. Pulsa **Comprobar TikTok** para confirmar el procesamiento. No repitas envíos si su estado es incierto; el programa los bloquea para evitar duplicaciones.

TikTok restringe a **Solo yo** las publicaciones hechas por aplicaciones sin auditoría hasta que se apruebe la integración. La API puede aceptar una solicitud y continuar procesándola: recibir un `publish_id` no garantiza que el contenido ya esté publicado. La fotografía se envía como un post fotográfico de TikTok; los videos usan Direct Post con URL verificada. En **Pendientes** y **Historial**, el control **Publicar en redes** permite seleccionar las plataformas conectadas cuyo envío siga pendiente. Solo se contactan las redes seleccionadas. TikTok solicita privacidad e interacciones antes de enviar; Meta y TikTok registran sus resultados por separado. La acción confirma el material clínico y no reenvía automáticamente entregas con estado incierto.

La base SQLite del piloto guarda tokens de TikTok y Meta sin cifrado de aplicación. Protege estrictamente `prisma/dev.db`, sus copias de seguridad y el servidor. Antes de ofrecerlo a otras clínicas, implementa cifrado de credenciales, roles y segregación por cliente.

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia el servidor de desarrollo. |
| `npm run build` | Compila la aplicación y comprueba los tipos de TypeScript. |
| `npm run start` | Inicia la compilación de producción después de `npm run build`. |

El proyecto incluye `npm test` para pruebas de persistencia, publicación y estados de redes sociales.

## Estructura del proyecto

    prisma/                 Esquema SQLite y migraciones
    src/app/dashboard/       Panel y acciones de la cola
    src/app/api/             Rutas de contenido, medios y conexión social
    src/components/          Formulario y cola de revisión
    src/config/              Términos permitidos y controles clínicos
    src/services/            Integración Gemini/Grok, procesamiento multimedia y almacenamiento
    src/lib/metaPublish.ts   Publicación en Meta
    storage/posts/           Medios guardados localmente durante el piloto

## Seguridad y uso clínico

- `.env`, la base SQLite local y los medios de prueba están excluidos de Git. Comprueba que siguen ignorados antes de preparar un commit.
- No incluyas tokens, contraseñas, archivos `.env` ni enlaces firmados en el repositorio.
- Los tokens OAuth de Meta se guardan en SQLite. Protege `prisma/dev.db` y sus copias de seguridad; no los compartas.
- Usa material autorizado por la clínica. No compartas fotos, videos, nombres ni otros datos identificables de pacientes sin la autorización correspondiente.
- Las fotografías enviadas a Gemini Vision requieren confirmación explícita y no se redirigen automáticamente a Grok. En el nivel gratuito de Gemini los datos pueden usarse para mejorar productos de Google: no utilices fotografías clínicas ni notas identificables en ese nivel sin una evaluación legal y de privacidad apropiada. Para casos reales, evalúa la opción de pago y los acuerdos aplicables.
- Revisa que el texto y la pieza visual sean correctos antes de aprobar la publicación. Los controles automáticos reducen algunos riesgos de redacción, pero no sustituyen el criterio del profesional.
- El piloto usa una contraseña compartida y una base SQLite local; no está configurado como una plataforma multi-clínica.

## Estado del piloto

La compilación de producción y la vista móvil se verificaron en el entorno local. La prueba de publicación de un Reel en Facebook fue aceptada por Meta. Instagram requiere que se vincule una cuenta profesional para probar esa ruta.
