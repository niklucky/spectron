import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMParser } from "@xmldom/xmldom";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { readOfficePreview } from "../src/lib/read-office-preview";
import type { OfficeFamily } from "../src/lib/office-file-format";

async function preview(family: OfficeFamily, parts: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [path, text] of Object.entries(parts)) await writer.add(path, new TextReader(text));
  return readOfficePreview(await writer.close(), family, new AbortController().signal);
}

test("Office previews read content even when the saved thumbnail is blank", async () => {
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: DOMParser });
  try {
    assert.deepEqual(await preview("Word", {
      "word/document.xml": '<w:document xmlns:w="urn:word"><w:p/><w:p><w:r><w:t>Отчёт </w:t></w:r><w:r><w:t>2026</w:t></w:r></w:p></w:document>',
      "docProps/thumbnail.jpeg": "",
    }), { kind: "text", paragraphs: ["Отчёт 2026"] });

    assert.deepEqual(await preview("Excel", {
      "xl/workbook.xml": '<workbook xmlns:r="urn:office/relationships"><sheet r:id="first"/></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="first" Target="worksheets/sheet2.xml"/></Relationships>',
      "xl/worksheets/sheet2.xml": '<sheet><row><c r="B1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row></sheet>',
      "xl/sharedStrings.xml": "<sst><si><t>Sales</t></si></sst>",
    }), { kind: "sheet", rows: [["", "Sales", "42"]] });

    assert.deepEqual(await preview("PowerPoint", {
      "ppt/slides/slide1.xml": "<slide><p><t>Quarterly results</t></p></slide>",
    }), { kind: "text", paragraphs: ["Quarterly results"] });
    assert.equal(await preview("Word", { "unrelated.xml": "<root/>" }), null);
  } finally {
    Reflect.deleteProperty(globalThis, "DOMParser");
  }
});
