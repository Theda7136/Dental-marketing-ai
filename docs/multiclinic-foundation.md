# Dental Studio: preparación multi-clínica

## Estado de esta fase

La base de datos incorpora `Clinic` y `clinicId` en `Account`,
`ScheduledPost` y `BrandProfile`. La migración crea la clínica `pilot`
y asocia automáticamente a ella los datos existentes, sin borrar registros.

**No es multi-tenant funcional todavía.** La aplicación sigue usando un único
acceso Basic Auth compartido, una única selección global de Página de Meta y
consultas que en muchos lugares no filtran por `clinicId`. **No se deben añadir
clínicas reales a esta misma instalación ni exponerla como SaaS antes de
corregir esos puntos.**

## Migrar el piloto (Windows)

1. Detener Next.js y cualquier proceso que escriba en SQLite.
2. Respaldar `prisma/dev.db` en una carpeta fuera del repositorio.
3. Ejecutar `git pull --ff-only origin feature/safe-content-review`,
   `npx prisma migrate deploy` y `npx prisma generate`.
4. Verificar con `npx tsc --noEmit`, `npm test` y `npm run build`.
5. Volver a entrar y revisar propuestas, calendario y conexiones.

No cambiar manualmente `clinicId` ni crear nuevos registros `Clinic` en
producción. Las nuevas columnas usan `pilot` como valor predeterminado para
mantener compatible el piloto existente.

## Fases necesarias antes de habilitar varias clínicas

1. Autenticación real por usuario, sesiones revocables y membresías por clínica;
   roles de propietario, administrador, editor y revisor.
2. Resolución de la clínica desde una sesión autenticada, **nunca** desde un
   encabezado o parámetro `clinicId` arbitrario enviado por el navegador.
3. Filtro de `clinicId` en **todas** las lecturas, escrituras y operaciones por
   identificador, incluyendo pendientes, calendario, propuestas, marca,
   conexiones Meta/TikTok, OAuth y publicación.
4. Rediseñar claves e índices únicos de cuentas sociales por clínica. El
   índice `Account(provider, providerAccountId)` actual sigue siendo global
   para proteger los datos del piloto; se cambiará junto con el aislamiento.
5. Aislamiento del almacenamiento multimedia y de las URLs firmadas por
   clínica; políticas de acceso, expiración y eliminación.
6. Cambiar la SQLite local del piloto por un servicio de base de datos apto
   para despliegue SaaS, con migración y validación de respaldos.
7. Pruebas adversariales entre dos clínicas: un usuario de A nunca puede leer
   ni modificar datos de B, incluso adivinando identificadores.
8. Auditoría, gestión de secretos, protección de tokens OAuth, consentimientos
   clínicos y políticas de respaldo por cliente.

El piloto actual sigue funcionando bajo la misma contraseña hasta que
termine el cambio de autenticación. Esa contraseña no constituye un sistema
multiusuario.
