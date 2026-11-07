# Ejecutar el piloto en local

## Variables para trabajar en local

El almacenamiento S3/R2 no es necesario mientras desarrollas en este equipo. Si no defines bucket ni credenciales de S3, los medios se guardan en `storage/posts`. La base de datos SQLite ya usa `prisma/dev.db`; no requiere `DATABASE_URL`.

`DENTAL_APP_PASSWORD` debe tener al menos 16 caracteres para abrir el panel. `XAI_API_KEY` se necesita para generar propuestas con Grok; `GROK_API_KEY` sigue aceptándose como nombre alternativo.

Para copiar la plantilla sin reemplazar una configuración existente, ejecuta desde PowerShell en la carpeta del proyecto:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Luego edita `.env` localmente y completa solo las claves que vas a usar. Puedes generar una contraseña aleatoria desde PowerShell sin compartirla:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Usa ese resultado para `DENTAL_APP_PASSWORD`. No uses la línea vacía de la plantilla como contraseña. Mantén `.env` privado.

## Conexiones opcionales

- Meta: completa `META_CLIENT_ID` y `META_CLIENT_SECRET` para conectar la Página. Si tu usuario administra varias Páginas, configura `META_PAGE_ID` con el ID de la Página piloto; así se evita elegir una al azar. El callback predeterminado apunta a `http://localhost:3000/api/auth/meta/callback`; ese URI debe coincidir con la configuración de la aplicación Meta. Después de cambiar `.env`, reinicia el servidor y reconecta Meta.
- Publicación desde el equipo local: además requiere `DENTAL_MEDIA_SIGNING_SECRET` y que Meta pueda acceder a la aplicación por HTTPS. `localhost` sirve para navegar desde tu equipo, pero Meta no puede descargar medios desde él.
- S3/R2: déjalo vacío en local. Configúralo cuando necesites que los medios sobrevivan fuera de este equipo o entre despliegues.

## Iniciar

```powershell
npm run dev
```

No copies ni envíes el contenido de `.env` en chats o capturas.
