export type OfficeFamily = "Word" | "Excel" | "PowerPoint";
type OfficeFormat = { family: OfficeFamily; extension: string; mime: string };

const openXml = "application/vnd.openxmlformats-officedocument";
const formats: OfficeFormat[] = [
  { family: "Word", extension: "DOCX", mime: `${openXml}.wordprocessingml.document` },
  { family: "Word", extension: "DOTX", mime: `${openXml}.wordprocessingml.template` },
  { family: "Word", extension: "DOCM", mime: "application/vnd.ms-word.document.macroenabled.12" },
  { family: "Word", extension: "DOTM", mime: "application/vnd.ms-word.template.macroenabled.12" },
  { family: "Word", extension: "DOC", mime: "application/msword" },
  { family: "Word", extension: "DOT", mime: "application/msword" },
  { family: "Excel", extension: "XLSX", mime: `${openXml}.spreadsheetml.sheet` },
  { family: "Excel", extension: "XLTX", mime: `${openXml}.spreadsheetml.template` },
  { family: "Excel", extension: "XLSM", mime: "application/vnd.ms-excel.sheet.macroenabled.12" },
  { family: "Excel", extension: "XLTM", mime: "application/vnd.ms-excel.template.macroenabled.12" },
  { family: "Excel", extension: "XLSB", mime: "application/vnd.ms-excel.sheet.binary.macroenabled.12" },
  { family: "Excel", extension: "XLS", mime: "application/vnd.ms-excel" },
  { family: "Excel", extension: "XLT", mime: "application/vnd.ms-excel" },
  { family: "PowerPoint", extension: "PPTX", mime: `${openXml}.presentationml.presentation` },
  { family: "PowerPoint", extension: "PPSX", mime: `${openXml}.presentationml.slideshow` },
  { family: "PowerPoint", extension: "POTX", mime: `${openXml}.presentationml.template` },
  { family: "PowerPoint", extension: "PPTM", mime: "application/vnd.ms-powerpoint.presentation.macroenabled.12" },
  { family: "PowerPoint", extension: "PPSM", mime: "application/vnd.ms-powerpoint.slideshow.macroenabled.12" },
  { family: "PowerPoint", extension: "POTM", mime: "application/vnd.ms-powerpoint.template.macroenabled.12" },
  { family: "PowerPoint", extension: "PPT", mime: "application/vnd.ms-powerpoint" },
  { family: "PowerPoint", extension: "PPS", mime: "application/vnd.ms-powerpoint" },
  { family: "PowerPoint", extension: "POT", mime: "application/vnd.ms-powerpoint" },
];
const genericTypes = new Set(["", "application/octet-stream", "application/zip", "application/x-zip-compressed", "application/x-cfb", "application/x-ole-storage"]);

export function officeFileFormat(filename: string, contentType: string) {
  const mime = contentType.split(";", 1)[0]!.trim().toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toUpperCase();
  const byName = formats.find(format => format.extension === extension);
  if (genericTypes.has(mime) || byName?.mime === mime) return byName;
  return formats.find(format => format.mime === mime);
}
