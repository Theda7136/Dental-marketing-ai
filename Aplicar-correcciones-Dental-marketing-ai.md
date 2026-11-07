# Aplicar las correcciones

El archivo `Dental-marketing-ai-fixes.patch` contiene una primera tanda de cambios para el repositorio.

## Aplicación

Desde la carpeta del repositorio, coloca el parche allí y ejecuta:

```powershell
git apply --check .\Dental-marketing-ai-fixes.patch
git apply .\Dental-marketing-ai-fixes.patch
npx prisma migrate dev
npx prisma generate
```

El primer comando solo comprueba que el parche encaje; el segundo modifica los archivos. Haz un respaldo de la base local antes de ejecutar la migración si contiene información que quieras conservar.

## Configuración de Meta

En el entorno de despliegue configura `NEXT_PUBLIC_APP_URL` con el dominio público de la aplicación y `META_REDIRECT_URI` con:

```text
https://TU-DOMINIO/api/auth/meta/callback
```

Registra esa misma dirección de retorno en la configuración de la aplicación de Meta. No pongas credenciales en este archivo ni en Git.

## Pendiente para producción

- El generador aún guarda medios en disco local. Para un despliegue con varias instancias o almacenamiento efímero, falta conectar almacenamiento persistente que entregue URL HTTPS pública a Meta.
- Las rutas de creación y lectura de publicaciones no tienen una autenticación de usuarios visible. Antes de exponer la app a Internet, hay que elegir e implementar el inicio de sesión y los permisos de cada clínica.
- La interfaz del dashboard conserva un flujo de propuestas en memoria que no utiliza el nuevo flujo persistido de `/api/create-post`. Esa integración requiere una corrección aparte.

El parche no incluye credenciales ni lee el archivo `.env`.
