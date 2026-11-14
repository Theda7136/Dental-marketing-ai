import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/studioSession.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const sessions = new Map();
const memberships = new Map();
const storage = {
  loginSession: {
    async findUnique({ where }) { return sessions.get(where.tokenHash) ?? null; },
    async create({ data }) {
      sessions.set(data.tokenHash, {
        ...data, revokedAt: null,
        user: { id: data.userId, disabledAt: null },
        clinic: { id: data.clinicId, status: "ACTIVE" },
      });
      return data;
    },
    async updateMany({ where, data }) {
      const entry = sessions.get(where.tokenHash);
      if (entry && entry.revokedAt === where.revokedAt) Object.assign(entry, data);
      return { count: entry ? 1 : 0 };
    },
  },
  clinicMembership: {
    async findUnique({ where }) {
      const { clinicId, userId } = where.clinicId_userId;
      return memberships.get(`${clinicId}:${userId}`) ?? null;
    },
  },
};

const imported = { exports: {} };
runInNewContext(`(function(require, module, exports) { ${compiled} })`, { Date })(
  (name) => {
    if (name === "@/lib/prisma") return { prisma: storage };
    if (name === "@/lib/studioCredentials") {
      return { hashSessionToken: (value) => `hash:${value}`, newSessionToken: () => "generated-token" };
    }
    throw new Error(`Unexpected dependency: ${name}`);
  },
  imported,
  imported.exports,
);

const { readStudioSession, createStudioSession, revokeStudioSession } = imported.exports;

function addSession(token, userId, clinicId, options = {}) {
  sessions.set(`hash:${token}`, {
    userId, clinicId,
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    user: { id: userId, disabledAt: null },
    clinic: { id: clinicId, status: "ACTIVE" },
    ...options,
  });
}

function addMember(userId, clinicId, role = "OWNER") {
  memberships.set(`${clinicId}:${userId}`, {
    role, user: { disabledAt: null }, clinic: { status: "ACTIVE" },
  });
}

test("sessions resolve memberships only within their original clinic", async () => {
  addSession("token-alpha", "user-1", "clinic-alpha");
  addMember("user-1", "clinic-alpha", "OWNER");
  addMember("user-1", "clinic-beta", "REVIEWER");

  const session = await readStudioSession("token-alpha");
  assert.equal(session?.clinic.id, "clinic-alpha");
  assert.equal(session?.role, "OWNER");

  addSession("token-beta", "user-2", "clinic-beta");
  addMember("user-2", "clinic-beta", "EDITOR");
  assert.equal((await readStudioSession("token-beta"))?.role, "EDITOR");
});

test("foreign-clinic membership cannot authorize an unrelated session", async () => {
  addSession("wrong-clinic", "user-3", "clinic-alpha");
  addMember("user-3", "clinic-beta", "OWNER");
  assert.equal(await readStudioSession("wrong-clinic"), null);
});

test("disabled users, disabled clinics, expired or revoked sessions fail closed", async () => {
  addMember("user-4", "clinic-alpha");
  addSession("disabled-user", "user-4", "clinic-alpha", { user: { id: "user-4", disabledAt: new Date() } });
  addSession("disabled-clinic", "user-4", "clinic-alpha", { clinic: { id: "clinic-alpha", status: "SUSPENDED" } });
  addSession("expired", "user-4", "clinic-alpha", { expiresAt: new Date(Date.now() - 1000) });
  addSession("revoked", "user-4", "clinic-alpha", { revokedAt: new Date() });

  for (const token of ["disabled-user", "disabled-clinic", "expired", "revoked"]) {
    assert.equal(await readStudioSession(token), null, token);
  }
});

test("creating a session rejects a membership in a different clinic", async () => {
  addMember("user-5", "clinic-beta");
  assert.equal(await createStudioSession("user-5", "clinic-alpha"), null);
  assert.equal(sessions.has("hash:generated-token"), false);
});

test("revoke prevents reuse of a session", async () => {
  addMember("user-6", "clinic-alpha");
  addSession("to-revoke", "user-6", "clinic-alpha");
  assert.equal((await readStudioSession("to-revoke"))?.clinic.id, "clinic-alpha");
  await revokeStudioSession("to-revoke");
  assert.equal(await readStudioSession("to-revoke"), null);
});
