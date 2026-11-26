import assert from "node:assert/strict";
import { test } from "node:test";
import { availableMappingOptions, jiraMappingRows } from "../../../packages/frontend/src/lib/jira-mapping-rows";

test("selecting, changing and clearing Jira mappings preserves provider row order", () => {
  const statuses = [
    { id: "100", name: "Reopened" },
    { id: "200", name: "In progress" },
    { id: "300", name: "Done" },
  ];
  const mappings: Record<string, string> = {};
  const rows = () => jiraMappingRows(statuses, Object.keys(mappings));
  assert.deepEqual(rows(), statuses);
  // Selecting the last row must not bring it above the first two.
  mappings["300"] = "local-done";
  assert.deepEqual(rows(), statuses);
  mappings["200"] = "local-started";
  assert.deepEqual(rows(), statuses);
  mappings["300"] = "local-cancelled";
  assert.deepEqual(rows(), statuses);
  delete mappings["200"];
  assert.deepEqual(rows(), statuses);
  delete mappings["300"];
  assert.deepEqual(rows(), statuses);
});

test("saved unavailable options remain visible without duplicating or moving available rows", () => {
  const available = [{ id: "done", name: "Done" }, { id: "labels", name: "Labels (tags)" }];
  assert.deepEqual(jiraMappingRows(available, ["missing", "labels", "done"]), [
    ...available,
    { id: "missing", name: "missing" },
  ]);
  assert.deepEqual(jiraMappingRows([], ["missing"]), [{ id: "missing", name: "missing" }]);
});

test("duplicate imported users keep their position and use the current Jira display name", () => {
  assert.deepEqual(jiraMappingRows([
    { id: "user-a", name: "Old name" },
    { id: "user-b", name: "Another user" },
    { id: "user-a", name: "Current name" },
  ], ["user-b"]), [
    { id: "user-a", name: "Current name" },
    { id: "user-b", name: "Another user" },
  ]);
});

test("mapping targets stay in their own row and return to the pool when released", () => {
  const a = { id: "a", name: "A" };
  const b = { id: "b", name: "B" };
  const options = [a, b];
  const mappings: Record<string, string | null> = { first: "a", legacyDuplicate: "a", ignored: null };
  assert.deepEqual(availableMappingOptions(mappings)(options, ""), [b]);
  assert.deepEqual(availableMappingOptions(mappings)(options, "a"), options);
  mappings.first = "b";
  assert.deepEqual(availableMappingOptions(mappings)(options, ""), []);
  delete mappings.legacyDuplicate;
  assert.deepEqual(availableMappingOptions(mappings)(options, ""), [a]);
  assert.deepEqual(availableMappingOptions()(options, ""), options);
});
