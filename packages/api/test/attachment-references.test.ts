import assert from "node:assert/strict";
import { test } from "node:test";
import { referencedAttachmentIds } from "../../backend/src/integrations/attachment-references";

test("ADF attachment references preserve source order and reject ambiguous names", () => {
  const files = [
    { id: "one", externalId: "1", filename: "first.png" },
    { id: "two", externalId: "2", filename: "second.png" },
    { id: "three", externalId: "3", filename: "duplicate.png" },
    { id: "four", externalId: "4", filename: "duplicate.png" },
  ];
  const media = (attrs: object) => ({ type: "media", attrs });
  assert.deepEqual(referencedAttachmentIds({ type: "doc", content: [
    { type: "mediaGroup", content: [media({ alt: "second.png" }), media({ id: "1" }), media({ alt: "second.png" })] },
    media({ alt: "duplicate.png" }), media({ alt: "missing.png" }),
  ] }, files), ["two", "one"]);
  assert.deepEqual(referencedAttachmentIds(null, files), []);
});

import { trackerImages } from "../../shared/src/tracker-images";
import { YandexTrackerClient } from "../../backend/src/integrations/yandex-client";

test("Tracker inline images use attachment IDs and preserve size hints and order", () => {
  assert.deepEqual(trackerImages("До ![image.png](/ajax/v2/attachments/1311?inline=true =613x102) после"), [{
    markup: "![image.png](/ajax/v2/attachments/1311?inline=true =613x102)",
    id: "1311", filename: "image.png", width: 613, height: 102,
  }]);
  assert.deepEqual(trackerImages("![x](https://untrusted.test/ajax/v2/attachments/1)"), []);
  assert.deepEqual(trackerImages("![x](/ajax/v2/attachments/1) ![x](/ajax/v2/attachments/2)").map(x => x.id), ["1", "2"]);
});

test("Tracker attachment downloads use the authenticated API and encoded path", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.tracker.yandex.net/v3/issues/TEST-1/attachments/1311/image%20one.png");
    assert.equal((init.headers as Record<string, string>).Authorization, "OAuth test");
    assert.equal((init.headers as Record<string, string>)["X-Org-ID"], "org");
    assert.equal(init.redirect, "error");
    return new Response("image");
  });
  const client = new YandexTrackerClient("test", "org");
  assert.equal(await new Response(await client.downloadAttachment("TEST-1", "1311", "image one.png")).text(), "image");
});
