# Aislamiento de datos — endurecimiento inicial del piloto

Este cambio agrega `clinicId: "pilot"` a las lecturas y escrituras principales de:

- Publicaciones, historial, aprobaciones, reintentos y calendario.
- Consulta y cambio de estado en motores Meta y TikTok.
- Consulta de cuentas sociales y actualización de credenciales.
- Identidad de marca y creación de propuestas.
- Acceso a archivos por identificador de publicación.
- Verificación de objetos Meta y reconexiones OAuth.

Incluye una prueba SQLite que crea un post de otra clínica y verifica
que el filtro `pilot` impida leerlo o modificarlo.

## Alcance y límites

**No es aislamiento multi-tenant completo.** Los filtros de esta fase son
constantes para el piloto, no se derivan todavía de sesiones con varias
clínicas. El proxy sigue admitiendo la contraseña Basic Auth anterior para
mantener la compatibilidad con el piloto. No hay invitaciones operativas ni
acceso funcional de usuarios con rol EDITOR/REVIEWER.

Antes de conectar nuevas clínicas hay que:

1. Resolver el `clinicId` exclusivamente desde sesión validada y eliminar
   el acceso Basic Auth compartido.
2. Aplicar la autorización de rol por operación en las rutas, Server Actions,
   OAuth, publicación y lectura de archivos.
3. Completar el flujo OAuth con un estado vinculado a clínica y sesión,
   sin claves únicas globales ambiguas para cuentas compartidas.
4. Aislar los archivos por prefijo de clínica y vincular su autorización
   con la clínica, tanto en enlaces firmados como en almacenamiento.
5. Migrar la identidad de marca de `id: "default"` a una clave única por
   clínica y preparar índices adecuados para cuentas sociales.
6. Auditar todas las rutas y ejecutar pruebas adversariales con dos clínicas,
   incluyendo acceso directo por identificador, CSRF y reclamación OAuth.
7. Eliminar la contraseña piloto heredada y endurecer el formulario de login
   con límites de intentos antes de exponer el servicio en Internet.

## Aplicación local

Detener el servidor, guardar copia SQLite fuera del repositorio, y ejecutar:

```powershell
git pull --ff-only origin feature/safe-content-review
npx prisma generate
npx tsc --noEmit
npm test
npm run build
npm run dev
```

Esta entrega no necesita migración Prisma adicional ni borra los datos del
piloto. Confirmar que siguen funcionando publicaciones pendientes, calendario,
Facebook, Instagram y TikTok. No realizar publicaciones reales de prueba sin
aprobación explícita.
