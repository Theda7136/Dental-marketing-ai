import assert from "node:assert/strict";
import test from "node:test";
import { smokeTest } from "../scripts/smoke-production.mjs";

test("deployment smoke test checks health and anonymous panel protection", async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(new URL(url).pathname);
    if (new URL(url).pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }
    return new Response(null, { status: 307, headers: { location: "/login" } });
  };
  const status = await smokeTest("https://dental.example.com", request);
  assert.deepEqual(status, { health: "ok", anonymousDashboard: "protected" });
  assert.deepEqual(calls, ["/api/health", "/dashboard"]);
});

test("deployment smoke test rejects unexpected private access", async () => {
  const request = async (url) => new URL(url).pathname === "/api/health"
    ? Response.json({ status: "ok" })
    : new Response("Panel visible", { status: 200 });
  await assert.rejects(smokeTest("https://dental.example.com", request), /sin sesión/);
});

test("deployment smoke test refuses HTTP origins", async () => {
  await assert.rejects(smokeTest("http://localhost:3000"), /HTTPS/);
});
