import assert from "node:assert/strict";
import { test } from "node:test";
import { firstMessageFields, messagePlainText } from "@spectron/shared";

test("first message keeps formatted details and derives a plain title", () => {
  const message = "**A clearer composer**\n- _Muted borders_\n- `Send` button";
  assert.deepEqual(firstMessageFields(message), {
    title: "A clearer composer",
    description: message,
  });
  assert.deepEqual(firstMessageFields(" Simple title "), {
    title: "Simple title",
    description: "",
  });
  assert.equal(messagePlainText("1. **First**\n2. _Second_"), "First\nSecond");
});
test("long first messages retain every character in the description", () => {
  const message = "A".repeat(300) + "\nDetails";
  const fields = firstMessageFields(message);
  assert.equal(fields.title.length, 255);
  assert.equal(fields.description, message);
  assert.equal(firstMessageFields("\n\n- **Привет**\nМир").title, "Привет");
});
