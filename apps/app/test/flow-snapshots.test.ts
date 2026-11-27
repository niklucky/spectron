import assert from "node:assert/strict";
import { test } from "node:test";
import { equalJson } from "@spectron/shared";

test("Flow snapshots compare nested fields by name and timeline entries by position", () => {
  const event = { id: "a", fields: { text: "hello", files: [] } };
  assert.ok(equalJson(event, { fields: { files: [], text: "hello" }, id: "a" }));
  assert.ok(!equalJson([event, null], [null, event]));
  assert.ok(!equalJson(event, { ...event, fields: { text: "edited", files: [] } }));
  assert.ok(!equalJson([], {}));
  assert.ok(!equalJson(JSON.parse('{"__proto__":1}'), { other: 1 }));
});
