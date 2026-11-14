# Despliegue de producción (preparación)

Dental Marketing AI sigue restringido a la clínica piloto. Este procedimiento define las condiciones previas, **no** habilita el SaaS multiempresa ni despliega servicios automáticamente.

## Arquitectura inicial

- Instancia Node.js persistente, con dominio y HTTPS detrás de un proxy inverso o terminador TLS.
- `prisma/dev.db` y sus archivos `-wal`/`-shm` en un **volumen persistente**. Evitar funciones serverless y discos efímeros. Usar una sola instancia que escriba en SQLite.
- S3/R2 privado para nuevas fotos y videos, con políticas de mínimo privilegio; no configurar acceso público a todo el bucket.
- El acceso público de Meta y TikTok a archivos específicos se hace por enlaces firmados temporales.
- Secretos configurados en el entorno del servidor, no incluidos en imágenes Docker, repositorio o registros.

## Antes de mover el piloto

1. Detener la aplicación actual y **respaldar** `prisma/dev.db`, incluyendo sus archivos asociados si existen, y toda la carpeta `storage/`. Con SQLite activo, preferir la API de backup de SQLite o `VACUUM INTO` frente a copiar solo `.db`. Comprobar que el respaldo puede restaurarse.
2. Probar en una instancia de ensayo con **copias**, nunca con la única base original.
3. Montar almacenamiento persistente para `prisma/` en la misma ruta que usa el esquema y configurar S3/R2.
4. Configurar `NEXT_PUBLIC_APP_URL=https://tu-dominio`, `META_REDIRECT_URI` y, si aplica, `TIKTOK_REDIRECT_URI` en los portales de desarrolladores.
5. Establecer contraseñas y firma de medios aleatorias, configurar Gemini, las claves OAuth y el bucket privado.
6. Ejecutar `npm ci`, `npx prisma migrate deploy`, `npx prisma generate`, `npx tsc --noEmit`, `npm test` y `npm run build`.
7. Ejecutar `npm run check:production` con el archivo `.env` del servidor. Es una **verificación mínima de configuración**, no comprueba el volumen, los permisos S3, los respaldos ni el acceso efectivo a Meta.
8. Probar inicio y cierre de sesión, creación de foto y video, lectura de una imagen antigua, OAuth, publicación de prueba, revisión de resultados inciertos y recuperación desde un respaldo.

## Respaldo SQLite verificado

En la instalación piloto, desde la raíz del proyecto y con dependencias instaladas:

```powershell
npm run backup:db
```

El script abre `prisma/dev.db`, genera una instantánea consistente mediante `VACUUM INTO` y verifica `PRAGMA integrity_check` antes de publicarla en `backups/sqlite/`. No sobrescribe la base original y las copias quedan excluidas de Git. Puede ejecutarse con el servidor activo, pero la validación sigue siendo necesaria.

**Esto no constituye por sí solo una estrategia de respaldo de producción:** un fallo del mismo disco puede destruir el original y la copia. La tarea operativa pendiente es cifrar y transferir periódicamente los respaldos a un destino privado externo, comprobar su integridad allí y **ensayar la restauración en un entorno aislado**. También se debe respaldar `storage/` si contiene medios del piloto y conservar los objetos S3/R2 necesarios para una recuperación consistente.

Antes de cualquier restauración real: detener la aplicación, preservar una copia del estado actual, restaurar en una ubicación de prueba y verificar el esquema, las sesiones, las publicaciones y los archivos. No ejecutar restauraciones sobre datos de producción sin un procedimiento validado.

## Recuperación

- Mantener respaldos automáticos fuera del servidor, cifrados, con retención definida y prueba periódica de restauración.
- Restaurar primero el archivo de base de datos compatible con la versión de esquema desplegada; restaurar `storage/` si se utilizó localmente. No restaurar datos del piloto sobre otras clínicas.
- Conservar los archivos de respaldo antes de aplicar migraciones nuevas. En un fallo, detener el servicio y recuperar **base y archivos consistentes** antes de reiniciar.
- Supervisar capacidad del volumen, fallos de lectura/escritura, vencimiento OAuth, latencia de renderización y errores de descarga. No registrar tokens ni fotos clínicas.

## Bloqueos para comercializar varias clínicas

Falta una prueba de integración de extremo a extremo con dos clínicas, una estrategia de base de datos compartida de mayor escala (o instancias aisladas), restauración demostrada, monitoreo y controles de privacidad clínica. No eliminar los bloqueos `pilot` de `src/proxy.ts` y `src/lib/studioAccess.ts` todavía.
