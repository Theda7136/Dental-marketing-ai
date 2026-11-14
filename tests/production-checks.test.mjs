import assert from "node:assert/strict";
import test from "node:test";
import { productionChecks } from "../scripts/production-checks.mjs";

const valid = {
  NEXT_PUBLIC_APP_URL: "https://dental.example.com",
  DENTAL_APP_PASSWORD: "sample-password-not-real",
  DENTAL_MEDIA_SIGNING_SECRET: "not-a-real-key-abcdefghijklmnopqrstuvwxyz",
  GEMINI_API_KEY: "test-key",
  AWS_S3_BUCKET_NAME: "test-bucket",
  AWS_ACCESS_KEY_ID: "test-access",
  AWS_SECRET_ACCESS_KEY: "test-secret",
};

test("valid minimum cloud environment passes preflight", () => {
  assert.deepEqual(productionChecks(valid), []);
});

test("localhost and incomplete persistence are rejected", () => {
  const failures = productionChecks({ ...valid, NEXT_PUBLIC_APP_URL: "http://localhost:3000", AWS_S3_BUCKET_NAME: "" });
  assert.ok(failures.some((message) => message.includes("HTTPS")));
  assert.ok(failures.some((message) => message.includes("S3/R2")));
});

test("secrets are checked without printing their values", () => {
  const failures = productionChecks({ ...valid, DENTAL_MEDIA_SIGNING_SECRET: "short", GEMINI_API_KEY: "" });
  assert.ok(failures.some((message) => message.includes("DENTAL_MEDIA_SIGNING_SECRET")));
  assert.ok(failures.some((message) => message.includes("GEMINI_API_KEY")));
  assert.ok(failures.every((message) => !message.includes(valid.AWS_SECRET_ACCESS_KEY)));
});

test("OAuth callback URLs must share the configured HTTPS origin", () => {
  const failures = productionChecks({
    ...valid,
    META_CLIENT_ID: "test",
    META_CLIENT_SECRET: "test",
    META_REDIRECT_URI: "https://elsewhere.example.com/api/auth/meta/callback",
  });
  assert.ok(failures.some((message) => message.includes("META_REDIRECT_URI")));
});
