import assert from "node:assert/strict";
import { test } from "node:test";
import { officeFileFormat } from "../../../packages/frontend/src/lib/office-file-format";

test("Office attachments use concise format labels from MIME or filename", () => {
  const lookup = (name: string, mime: string) => officeFileFormat(name, mime)?.extension;
  assert.equal(lookup("report", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "DOCX");
  assert.equal(lookup("данные.XLSX", "application/zip"), "XLSX");
  assert.equal(lookup("slides.PPT", "application/x-cfb"), "PPT");
  assert.equal(lookup("report.docm", ""), "DOCM");
  assert.equal(lookup("slides.pps", "application/vnd.ms-powerpoint"), "PPS");
  assert.equal(lookup("legacy.doc", "application/octet-stream"), "DOC");
  assert.equal(lookup("report.xls", "Application/Vnd.Ms-Excel.Sheet.MacroEnabled.12; charset=binary"), "XLSM");
  assert.equal(lookup("report.docx", "image/png"), undefined);
  assert.equal(lookup("archive.zip", "application/zip"), undefined);
});
