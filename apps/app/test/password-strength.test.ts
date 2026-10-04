import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordStrength } from "../../../packages/frontend/src/lib/password-strength";

test("anything under the minimum is too short", () => {
  assert.equal(passwordStrength("").score, 0);
  assert.equal(passwordStrength("Ab1!xyz").score, 0);
  assert.equal(passwordStrength("abcdefgh", 10).score, 0);
});

test("eight lowercase letters are weak", () => {
  assert.deepEqual(passwordStrength("mountain"), { score: 1, label: "Weak" });
});

test("strength grows with variety and length", () => {
  assert.equal(passwordStrength("mountainsarehigh").score, 3);
  assert.equal(passwordStrength("Mountain7").score, 3);
  assert.equal(passwordStrength("Mountain7!river").label, "Strong");
});

test("common words and runs are penalized", () => {
  assert.equal(passwordStrength("Password1!").score, 1);
  assert.equal(passwordStrength("aaaaaaaaaaaa").score, 1);
  assert.equal(passwordStrength("Abcd1234!").score, 1);
});
