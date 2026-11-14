import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSqliteBackup } from "../scripts/sqlite-backup.mjs";

test("a verified snapshot retains committed data and does not overwrite the source", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dental-backup-test-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const databasePath = path.join(directory, "live.db");
  const backupDirectory = path.join(directory, "archives");
  const writer = new PrismaClient({ datasources: { db: { url: `file:${databasePath.replaceAll("\\", "/")}` } } });
  try {
    await writer.$executeRawUnsafe('CREATE TABLE "backup_check" ("name" TEXT NOT NULL)');
    await writer.$executeRawUnsafe("INSERT INTO backup_check (name) VALUES ('pilot')");

    const { file, bytes } = await createSqliteBackup({ databasePath, backupDirectory });
    assert.ok(bytes > 0);
    assert.ok(file.startsWith(backupDirectory));

    await writer.$executeRawUnsafe("INSERT INTO backup_check (name) VALUES ('after-backup')");
    const restored = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
    try {
      const rows = await restored.$queryRawUnsafe('SELECT "name" FROM "backup_check" ORDER BY "name"');
      assert.deepEqual(rows.map((row) => row.name), ["pilot"]);
      assert.equal((await restored.$queryRawUnsafe("PRAGMA integrity_check"))[0].integrity_check, "ok");
    } finally {
      await restored.$disconnect();
    }
  } finally {
    await writer.$disconnect();
  }
});

test("backup fails when the source database does not exist", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dental-backup-missing-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(
    createSqliteBackup({
      databasePath: path.join(directory, "missing.db"),
      backupDirectory: path.join(directory, "archives"),
    }),
    /ENOENT/,
  );
});
