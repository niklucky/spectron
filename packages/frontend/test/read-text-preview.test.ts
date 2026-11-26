import { test } from "node:test";
import assert from "node:assert/strict";
import { textFileFormat } from "@spectron/shared";
import { readTextPreview } from "../src/lib/read-text-preview";

test("text preview recognizes stored generic files and preserves literal content", async () => {
  assert.equal(textFileFormat("example.JSON", "application/octet-stream")?.extension, "JSON");
  assert.equal(textFileFormat("example.txt", "")?.extension, "TXT");
  assert.equal(textFileFormat("example.txt", "image/png"), undefined);
  for (const source of ['{"id":9007199254740993}', "<b>Текст</b>\n\tSecond line"]) {
    const url = URL.createObjectURL(new Blob([source]));
    try {
      assert.deepEqual(await readTextPreview(url, new AbortController().signal), { kind: "source", text: source, truncated: false });
    } finally { URL.revokeObjectURL(url); }
  }
});

test("preview stops at the byte limit without breaking a multibyte character", async () => {
  const prefix = "a".repeat(65535);
  const url = URL.createObjectURL(new Blob([prefix + "Жtail"]));
  try {
    assert.deepEqual(await readTextPreview(url, new AbortController().signal), { kind: "source", text: prefix, truncated: true });
  } finally { URL.revokeObjectURL(url); }
});

test("an unsatisfiable range identifies an empty stored file only when the total is zero", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    new Response(null, { status: 416, headers: { "Content-Range": "bytes */0" } }));
  const read = () => readTextPreview("https://files.invalid/empty.txt", new AbortController().signal);
  assert.deepEqual(await read(), { kind: "source", text: "", truncated: false });
  fetch.mock.mockImplementation(async () => new Response(null, { status: 416, headers: { "Content-Range": "bytes */50" } }));
  assert.equal(await read(), null);
});
