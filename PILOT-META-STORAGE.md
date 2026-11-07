# Configuración del almacenamiento y Meta para la clínica piloto

## Almacenamiento persistente

El sistema admite cualquier servicio compatible con S3, incluido Cloudflare R2. El bucket debe ser privado; la aplicación descarga los medios por su API y entrega a Meta una dirección temporal firmada. No habilites lectura pública del bucket.

Configura estas variables en el entorno del servidor (no en el navegador):

- `AWS_S3_BUCKET_NAME`: nombre del bucket.
- `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`: credenciales de escritura/lectura limitadas a ese bucket.
- `AWS_REGION`: región del proveedor; para R2 usa `auto`.
- `AWS_S3_ENDPOINT`: opcional para S3 estándar; requerido para R2, con el endpoint S3 de tu cuenta.
- `DENTAL_MEDIA_SIGNING_SECRET`: valor aleatorio privado de al menos 32 caracteres.
- `NEXT_PUBLIC_APP_URL`: dirección HTTPS pública de la aplicación, sin ruta final.

Si no se configuran bucket y credenciales, la aplicación usa almacenamiento local para desarrollo. En servidores de producción con disco temporal o efímero, configura S3/R2 para que los medios sobrevivan reinicios y despliegues.

Después de cambiar variables, reinicia/re despliega el servidor. No compartas `.env`, tokens ni claves.

## Conectar Meta

Desde el panel vuelve a conectar la Página. La autorización ahora solicita `pages_manage_posts`, necesario para publicar en la Página. La cuenta de Instagram debe ser profesional y estar vinculada a la Página. La cuenta que autoriza debe tener permisos suficientes y la aplicación de Meta puede requerir revisión antes de publicar a usuarios fuera del modo de desarrollo.

Meta debe poder descargar los archivos por HTTPS. Los enlaces firmados duran hasta 12 horas y solo sirven para el archivo asociado; no publiques estos enlaces en lugares públicos.

## Videos

Los clips se exportan en MP4 vertical 1080×1920 a 30 fps y se limitan a 60 segundos para ajustarse a la ruta de Reels de Facebook. Al aprobar un video, el sistema crea y procesa el contenedor de Instagram y abre una sesión de carga alojada para Reels de Facebook.

La cola cambia a publicado cuando al menos una red confirma la publicación. Si la otra red devuelve un error, el panel mostrará una advertencia; revisa la red indicada antes de volver a aprobar para evitar duplicados.
