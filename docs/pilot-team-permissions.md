# Equipo y permisos — clínica piloto

## Incluido

- Inicio de sesión con usuario propio para propietario, administrador, editor y revisor.
- Autorización en el proxy según ruta y método, verificada contra una sesión de la
  clínica piloto. Se deja de admitir el acceso Basic Auth enviado directamente
  por los navegadores; el servidor conserva el secreto anterior únicamente
  para llamar a los handlers heredados **tras validar una sesión**.
- Todas las Server Actions comprueban su permiso antes de operar.
- Página `/dashboard/equipo` para ver miembros, invitarlos, cambiar roles,
  retirarlos y revocar invitaciones.
- Invitaciones privadas de 48 horas, de uso único, copiadas manualmente por
  propietario/administrador. **No se envían correos automáticamente**.
- Al cambiar un rol o retirar a una persona se revocan sus sesiones.
- Aprobación clínica separada de publicación: un revisor puede registrar la
  correspondencia clínica, pero no enviar contenido a redes.

## Permisos

| Acción | Propietario | Administrador | Editor | Revisor |
|---|---|---|---|---|
| Consultar propuestas | Sí | Sí | Sí | Sí |
| Crear y editar | Sí | Sí | Sí | No |
| Revisar y rechazar | Sí | Sí | No | Sí |
| Publicar en redes | Sí | Sí | No | No |
| Gestionar conexiones | Sí | Sí | No | No |
| Gestionar usuarios | Sí | Sí | No | No |
| Configurar marca | Sí | Sí | No | No |

Los administradores no pueden modificar propietarios ni otros administradores,
ni invitar administradores. Solo el propietario puede asignar rol ADMIN.
Nadie puede retirarse o cambiar su propio rol desde este panel.

## Actualización de la clínica piloto

Detén Next.js, respalda `prisma/dev.db` **fuera del repositorio** y ejecuta:

```powershell
git pull --ff-only origin feature/safe-content-review
npx prisma migrate deploy
npx prisma generate
npx tsc --noEmit
npm test
npm run build
npm run dev
```

Inicia sesión con tu usuario propietario existente, abre
`http://localhost:3000/dashboard/equipo` y crea una invitación.

**Atención:** un enlace generado en `http://localhost:3000` solo funciona en
esa máquina. Para invitar usuarios desde otros dispositivos necesitas una URL
HTTPS accesible de manera segura; no expongas el servidor local ni los datos
clínicos sin endurecer antes el despliegue. Nunca compartas una contraseña
personal; la invitación permite al destinatario elegir la suya.

## Comprobaciones recomendadas

1. Verifica que el propietario continúa entrando y puede gestionar Equipo.
2. Invita a un editor y a un revisor de prueba. Confirma que cada uno tiene
   acceso solo a las secciones permitidas.
3. Prueba acceso directo a `/dashboard/equipo`, `/dashboard/conexiones`
   y a APIs de publicación con sesión de editor/revisor: debe rechazarse.
4. Comprueba que el revisor puede aprobar la revisión clínica sin que se envíe
   nada a Facebook, Instagram o TikTok.
5. Cambia un rol y confirma que la sesión anterior queda revocada.
6. Verifica que no se perdieron propuestas, conexiones y calendario.

No hagas publicaciones reales como parte de las pruebas automatizadas.

## Todavía pendiente para SaaS multi-clínica

El contexto de clínica continúa limitado a `pilot`. Las conexiones OAuth,
el almacenamiento y los tokens multimedia aún requieren aislamiento completo
por clínica, una configuración de URLs por cliente y pruebas adversariales
de acceso cruzado. Además faltan un proveedor de correo, protección contra
fuerza bruta, recuperación de contraseñas y endurecimiento del despliegue.

**No registrar clínicas de clientes adicionales ni exponer este piloto a
Internet** hasta completar esas protecciones.
