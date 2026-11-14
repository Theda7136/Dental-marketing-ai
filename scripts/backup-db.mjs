import { createSqliteBackup } from "./sqlite-backup.mjs";

try {
  const backup = await createSqliteBackup();
  console.log(`Copia SQLite verificada: ${backup.file} (${backup.bytes} bytes)`);
  console.log("Copia este archivo a un almacenamiento privado externo y comprueba su restauración antes de considerarlo un respaldo operativo.");
} catch (error) {
  console.error("No se pudo crear o validar el respaldo SQLite:", error instanceof Error ? error.message : "Error desconocido.");
  process.exitCode = 1;
}
