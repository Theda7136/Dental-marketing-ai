# Acceso del propietario de la clínica piloto

Esta entrega habilita un acceso adicional para **el propietario de la clínica piloto**:
pantalla de inicio de sesión, cookie HttpOnly con sesión revocable y botón
de cierre de sesión. El acceso Basic Auth anterior sigue disponible durante
la transición. Los roles de otras clínicas y las invitaciones siguen
deshabilitados para evitar accesos entre clientes.

## Preparación local en PowerShell

Detener el servidor y respaldar SQLite **fuera** del repositorio. Luego:

```powershell
git pull --ff-only origin feature/safe-content-review
npx prisma migrate deploy
npx prisma generate
npx tsc --noEmit
npm test
npm run build
```

Crear el primer propietario usando una contraseña que nunca se escribe en
el historial de comandos:

```powershell
$secret = Read-Host "Contraseña nueva del propietario (mínimo 16 caracteres)" -AsSecureString
$env:DENTAL_OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", $secret).Password
try {
  node scripts/bootstrap-pilot-owner.mjs doctor@clinica.com Nombre Apellido
} finally {
  Remove-Item Env:\DENTAL_OWNER_PASSWORD -ErrorAction SilentlyContinue
}
```

Cambiar `doctor@clinica.com Nombre Apellido` por los datos reales; no incluir
la contraseña en argumentos ni en `.env`.

`node scripts/bootstrap-pilot-owner.mjs` solo permite un propietario inicial
para `pilot`. No crea usuarios por defecto ni altera registros existentes.

Después de `npm run dev`, abrir `http://localhost:3000/login` y acceder
con el correo y la nueva contraseña. El navegador guarda una cookie privada
de sesión; el cierre de sesión revoca la sesión en la base de datos.

## Estado de seguridad y límites

- Se aceptan sesiones únicamente para propietarios de `pilot`; la sesión
  se verifica en la base de datos con expiración, revocación y membresía.
- El proxy traduce temporalmente las sesiones válidas del propietario
  piloto al mecanismo Basic Auth anterior **solo en el servidor**.
- Las rutas de publicación, Meta/TikTok y medios aún usan consultas
  globales sin filtros obligatorios por clínica. Solo existe una clínica
  operativa; **no habilitar usuarios de otras clínicas**.
- Faltan protección contra intentos reiterados de login, verificación
  de correo, recuperación de cuenta y controles de dispositivos.
- No exponer este servidor a Internet ni distribuirlo como SaaS antes de
  completar aislamiento, pruebas de acceso cruzado y defensas de login.
- Para la transición definitiva hay que retirar Basic Auth y sustituir
  todas las comprobaciones de autorizaciones por sesiones y permisos
  validados a nivel de operación, no únicamente en el proxy.

## Próximas entregas

1. Aislar publicaciones, cuentas sociales, marcas, OAuth y archivos por
   `clinicId` en todos los accesos y cambios de estado.
2. Activar RBAC en cada ruta y Server Action con pruebas adversariales.
3. Invitaciones con tokens de un solo uso, caducidad, correo
   verificado y administración de membresías.
4. Retirar la contraseña compartida y habilitar clínicas adicionales
   solo tras auditoría y pruebas.
