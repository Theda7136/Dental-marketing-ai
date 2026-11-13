# Usuarios y sesiones por clínica — Fase de preparación

## Alcance de esta entrega

Se crean cuatro roles: `OWNER`, `ADMIN`, `EDITOR` y `REVIEWER`.
Cada `StudioUser` puede pertenecer a una clínica a través de
`ClinicMembership`. Cada `LoginSession` conserva su clínica, el usuario,
una huella SHA-256 del token (nunca el token completo), vencimiento y revocación.

Las contraseñas nuevas se derivan con scrypt y sal aleatoria. No hay
contraseñas por defecto, usuarios automáticos ni registro público.

La matriz de permisos está declarada en `src/lib/clinicPermissions.ts`,
pero **todavía no está aplicada a las rutas**. Las funciones de sesión
están disponibles, pero **no se aceptan cookies de sesión en el proxy**.
La contraseña Basic Auth del piloto sigue siendo la única autenticación
activa. No activar otras clínicas ni compartir el despliegue con terceros.

## Migración y pruebas locales

1. Detén el servidor y respalda `prisma/dev.db` fuera del repositorio.
2. `git pull --ff-only origin feature/safe-content-review`
3. `npx prisma migrate deploy`
4. `npx prisma generate`
5. `npx tsc --noEmit`
6. `npm test`
7. `npm run build`

La migración crea las tablas `StudioUser`, `ClinicMembership` y
`LoginSession` vacías. No cambia publicaciones, cuentas sociales ni
contraseñas existentes.

## Activación segura pendiente

- Incorporar un alta inicial local de propietario con contraseña segura,
  sin credenciales embebidas en código ni registro público.
- Crear login, logout y controles de sesión con cookie HttpOnly, Secure
  en HTTPS, SameSite, expiración y defensa CSRF.
- Resolver contexto de clínica desde la sesión, comprobar membresía y rol
  en cada operación, incluidos Server Actions y APIs.
- Filtrar todas las consultas por clínica, incluso operaciones por ID,
  OAuth, cuentas de Meta, tokens, almacenamiento multimedia y URL firmadas.
- Pruebas de acceso cruzado entre clínicas, fijación de sesión y revocación.
- Solo entonces retirar Basic Auth y activar varias clínicas.

Nunca habilitar el acceso de múltiples clientes únicamente añadiendo un
selector de clínica en la interfaz.
