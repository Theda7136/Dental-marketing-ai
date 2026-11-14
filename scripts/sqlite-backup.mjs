import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function sqliteUrl(databasePath) {
  return `file:${databasePath.replaceAll("\\", "/")}`;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function verifySnapshot(snapshotPath) {
  const client = new PrismaClient({ datasources: { db: { url: sqliteUrl(snapshotPath) } } });
  try {
    const integrity = await client.$queryRawUnsafe("PRAGMA integrity_check");
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
      throw new Error("La copia SQLite no superó la verificación de integridad.");
    }
  } finally {
    await client.$disconnect();
  }
}

export async function createSqliteBackup({
  databasePath = path.resolve("prisma/dev.db"),
  backupDirectory = path.resolve("backups/sqlite"),
  timestamp = new Date(),
} = {}) {
  const source = path.resolve(databasePath);
  const destination = path.resolve(backupDirectory);
  if (destination === path.dirname(source) || destination.startsWith(source + path.sep)) {
    throw new Error("La carpeta de respaldos debe ser independiente de la base de datos.");
  }
  const sourceStats = await stat(source);
  if (!sourceStats.isFile()) throw new Error("La base de datos no es un archivo.");
  await mkdir(destination, { recursive: true, mode: 0o700 });

  const backupName = `dental-${timestamp.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.db`;
  const finalPath = path.join(destination, backupName);
  const temporaryPath = path.join(destination, `.${backupName}.partial`);
  const prisma = new PrismaClient({ datasources: { db: { url: sqliteUrl(source) } } });
  try {
    // VACUUM INTO creates a consistent snapshot even when SQLite uses WAL.
    await prisma.$executeRawUnsafe(`VACUUM INTO ${sqlString(temporaryPath.replaceAll("\\", "/"))}`);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  } finally {
    await prisma.$disconnect();
  }

  try {
    await verifySnapshot(temporaryPath);
    await rename(temporaryPath, finalPath);
    return { file: finalPath, bytes: (await stat(finalPath)).size };
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
