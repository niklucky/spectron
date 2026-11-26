import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from "@zip.js/zip.js/lib/zip-core-native.js";
import type { OfficeFamily } from "./office-file-format";

export type OfficePreviewData =
  | { kind: "text"; paragraphs: string[] }
  | { kind: "sheet"; rows: string[][] }
  | { kind: "image"; blob: Blob };

function elements(root: Document | Element, name: string) {
  return Array.from(root.getElementsByTagNameNS("*", name));
}

function runs(root: Element) {
  return elements(root, "t").map(el => el.textContent).join("").trim().slice(0, 2000);
}

export async function readOfficePreview(blob: Blob, family: OfficeFamily, signal: AbortSignal): Promise<OfficePreviewData | null> {
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  const entries = new Map<string, FileEntry>();
  async function bytes(path: string) {
    const entry = entries.get(path);
    if (!entry || entry.encrypted || entry.uncompressedSize > 4 * 1024 * 1024) return null;
    return entry.getData(new Uint8ArrayWriter(), { signal, checkSignature: true });
  }
  async function xml(path: string) {
    const data = await bytes(path);
    if (!data) return null;
    const text = new TextDecoder().decode(data);
    if (/<!DOCTYPE/i.test(text)) return null;
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return doc.getElementsByTagName("parsererror").length ? null : doc;
  }
  // Workbook and presentation order can differ from numbered ZIP filenames.
  async function firstPart(main: string, tag: string, fallback: string) {
    const index = await xml(main);
    const first = index && elements(index, tag)[0];
    const id = first && Array.from(first.attributes).find(a => a.localName === "id" && a.namespaceURI?.endsWith("/relationships"))?.value;
    if (!id) return fallback;
    const rels = await xml(main.replace(/([^/]+)$/, "_rels/$1.rels"));
    const rel = rels && elements(rels, "Relationship").find(r => r.getAttribute("Id") === id);
    const target = rel?.getAttribute("Target");
    if (!target || rel?.getAttribute("TargetMode") === "External") return fallback;
    return new URL(target, "https://package.invalid/" + main).pathname.slice(1);
  }
  try {
    let count = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      signal.throwIfAborted();
      if (++count > 12000) return null;
      if (!entry.directory) entries.set(entry.filename, entry);
    }
    if (family === "Excel") {
      const sheet = await xml(await firstPart("xl/workbook.xml", "sheet", "xl/worksheets/sheet1.xml"));
      if (sheet) {
        const strings = await xml("xl/sharedStrings.xml");
        const table = strings ? elements(strings, "si") : [];
        const rows: string[][] = [];
        for (const row of elements(sheet, "row")) {
          const values: string[] = [];
          for (const c of elements(row, "c")) {
            const letters = c.getAttribute("r")?.match(/^[A-Z]+/)?.[0];
            const col = letters ? [...letters].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1 : values.length;
            if (col >= 12) continue;
            const value = elements(c, "v")[0]?.textContent ?? "";
            const type = c.getAttribute("t");
            const shared = type === "s" && value !== "" ? table[Number(value)] : undefined;
            values[col] = shared ? runs(shared) : type === "inlineStr" ? runs(c) : value.slice(0, 2000);
          }
          if (values.some(Boolean)) rows.push(Array.from(values, v => v ?? ""));
          if (rows.length === 30) break;
        }
        if (rows.length) return { kind: "sheet", rows };
      }
    } else {
      const path = family === "Word" ? "word/document.xml" : await firstPart("ppt/presentation.xml", "sldId", "ppt/slides/slide1.xml");
      const doc = await xml(path);
      if (doc) {
        const paragraphs: string[] = [];
        for (const paragraph of elements(doc, "p")) {
          const text = runs(paragraph);
          if (text) paragraphs.push(text);
          if (paragraphs.length === 40) break;
        }
        if (paragraphs.length) return { kind: "text", paragraphs };
      }
    }
    const cover = [...entries.keys()].find(name => /^docProps\/thumbnail\.(jpe?g|png)$/i.test(name));
    const data = cover && await bytes(cover);
    return data ? { kind: "image", blob: new Blob([data], { type: /\.png$/i.test(cover) ? "image/png" : "image/jpeg" }) } : null;
  } finally {
    await reader.close();
  }
}
