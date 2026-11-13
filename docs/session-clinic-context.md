# Contexto de clínica obtenido desde la sesión

## Alcance de esta etapa

Se empieza a reemplazar el filtro fijo `clinicId: "pilot"` por
`session.clinic.id` en operaciones que ya disponen de una sesión validada:

- Lectura, archivado y planificación de publicaciones.
- Creación de propuestas y consulta de la identidad de marca para fotografías.
- Administración de la identidad visual.
- Consulta de conexiones Meta y TikTok, incluyendo sincronización del Instagram asociado.
- Acceso a publicación/consulta de estado de TikTok desde la API (validación de permiso).
- Todas las Server Actions del Dashboard, tanto edición como revisión y publicación.

Estas operaciones comprueban permisos con `getStudioAccess` dentro del
propio handler o acción, además de la verificación previa del proxy.

## Precauciones

**Esta migración es parcial y NO habilita multiclínica.**
`getStudioAccess` y el proxy todavía rechazan cualquier sesión cuyo
`clinic.id` no sea `pilot`. No se han cambiado el sistema OAuth ni
el almacenamiento de archivos.

Los motores internos `metaPublish`, `tiktokPublisher`, el acceso a medios
firmados y las rutas callback OAuth continúan anclados al piloto.
El índice global de cuentas sociales y la identidad de marca `id=default`
también deben migrarse antes de activar otras clínicas. Esto se hará
junto con pruebas adversariales que demuestren aislamiento cruzado.

No utilizar parámetros `clinicId` del navegador para decidir el ámbito de
las consultas. El identificador debe proceder siempre de una sesión
autenticada y una membresía activa.

## Actualización y pruebas locales

Detén Next.js, respalda `prisma/dev.db` fuera del repositorio y ejecuta:

```powershell
git pull --ff-only origin feature/safe-content-review
npx prisma generate
npx tsc --noEmit
npm test
npm run build
npm run dev
```

No se añadió migración de Prisma ni se modificó ningún dato persistido.

Verifica el acceso de propietario, administrador, editor y revisor;
el listado de publicaciones, edición y aprobación de propuestas,
calendario, marca, conexiones y creación de contenido.

No se requieren envíos reales a redes sociales para validar esta etapa.
