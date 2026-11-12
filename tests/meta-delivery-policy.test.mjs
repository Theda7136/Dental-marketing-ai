import assert from "node:assert/strict";
import test from "node:test";
import {
  canSendToNetwork,
  canStartInitialPublication,
  canEditUnsentProposal,
  requiresManualReconciliation,
} from "../src/lib/metaDeliveryPolicy.mjs";

test("only never-attempted networks are eligible for sending", () => {
  for (const blocked of ["SUCCEEDED", "UNKNOWN", "IN_PROGRESS", "FAILED", undefined, null]) {
    assert.equal(canSendToNetwork(blocked), false, `Must reject ${String(blocked)}`);
  }
  assert.equal(canSendToNetwork("PENDING"), true);
});

test("successful Facebook delivery cannot be resent when Instagram remains pending", () => {
  const post = { facebookStatus: "SUCCEEDED", instagramStatus: "PENDING" };
  assert.equal(canSendToNetwork(post.facebookStatus), false);
  assert.equal(canSendToNetwork(post.instagramStatus), true);
  assert.equal(canStartInitialPublication(post), false);
});

test("uncertain outcomes must be reconciled without a retry", () => {
  for (const status of ["UNKNOWN", "IN_PROGRESS"]) {
    assert.equal(requiresManualReconciliation(status), true);
    assert.equal(canSendToNetwork(status), false);
  }
  assert.equal(requiresManualReconciliation("PENDING"), false);
  assert.equal(requiresManualReconciliation("SUCCEEDED"), false);
});

test("initial publication and caption edits require both networks untouched", () => {
  const untouched = { facebookStatus: "PENDING", instagramStatus: "PENDING" };
  assert.equal(canStartInitialPublication(untouched), true);
  assert.equal(canEditUnsentProposal(untouched), true);

  for (const touched of ["SUCCEEDED", "UNKNOWN", "IN_PROGRESS"]) {
    assert.equal(canStartInitialPublication({ ...untouched, facebookStatus: touched }), false);
    assert.equal(canEditUnsentProposal({ ...untouched, instagramStatus: touched }), false);
  }
});

test("unexpected or missing states fail closed", () => {
  assert.equal(canSendToNetwork("pending"), false);
  assert.equal(canStartInitialPublication({ facebookStatus: undefined, instagramStatus: "PENDING" }), false);
});
