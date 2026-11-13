# Conservar datos locales al dejar de versionar SQLite

A partir de este cambio, Git deja de rastrear `prisma/dev.db` y `tsconfig.tsbuildinfo`.
Esto **no** borra el historial anterior de Git. La base de datos local de cada clínica
debe permanecer fuera de los commits y no se debe subir al repositorio.

## Migración segura para instalaciones existentes (PowerShell)

Detén Next.js y ejecuta estos comandos desde la carpeta del proyecto:

```powershell
$backupDir = Join-Path $env:USERPROFILE ("DentalStudio-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupDir | Out-Null
Copy-Item .\prisma\dev.db (Join-Path $backupDir "dev.db") -ErrorAction Stop
if (Test-Path .\tsconfig.tsbuildinfo) {
  Copy-Item .\tsconfig.tsbuildinfo (Join-Path $backupDir "tsconfig.tsbuildinfo")
}

git fetch origin
git restore -- prisma/dev.db tsconfig.tsbuildinfo
git pull --ff-only origin feature/safe-content-review

Copy-Item (Join-Path $backupDir "dev.db") .\prisma\dev.db -Force
npx prisma generate
git status
```

`git restore` se usa **solamente después del respaldo** y únicamente sobre los dos
archivos rastreados que se retiran del repositorio. El `git pull` borra las versiones
rastreadas, y `Copy-Item` devuelve la base de datos real de la clínica a su ubicación.

Si cualquier comando falla, detente antes de continuar. Conserva `$backupDir`.

En instalaciones nuevas se debe inicializar SQLite mediante las migraciones Prisma:
`npx prisma migrate deploy`. Las migraciones no deben sobreescribir bases existentes.

## Verificación

```powershell
git ls-files prisma/dev.db tsconfig.tsbuildinfo
git check-ignore prisma/dev.db tsconfig.tsbuildinfo
git status
```

`git ls-files` no debe mostrar esos archivos. `git check-ignore` sí debe mostrarlos.
Los respaldos locales `prisma/dev.db.backup` y `prisma/dev.db.before-...` también se ignoran.

Si hay datos sensibles en commits antiguos, quitarlos de la rama actual no los elimina
del historial: antes de distribuir el repositorio hay que valorar rotar credenciales
almacenadas y purgar el historial con un procedimiento coordinado.
