import sharp from "sharp";
import { load } from "cheerio";
import { decodeIco } from "icojs";

export const maxLogoBytes = 2 * 1024 * 1024;
export class LogoError extends Error {}

function sanitizeSVG(source: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new LogoError("Unsupported SVG.");
  const $ = load(source, { xml: true });
  const tags = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "defs",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "title",
    "desc",
  ]);
  const attrs = new Set([
    "xmlns",
    "viewBox",
    "width",
    "height",
    "d",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "points",
    "fill",
    "fill-rule",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-opacity",
    "stroke-dasharray",
    "opacity",
    "transform",
    "id",
    "href",
    "xlink:href",
    "clip-path",
    "mask",
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "preserveAspectRatio",
  ]);
  $("*").each((_, element) => {
    if (!("attribs" in element) || !tags.has(element.name)) {
      $(element).remove();
      return;
    }
    for (const [name, value] of Object.entries(element.attribs)) {
      if (
        (["fill", "stroke", "clip-path", "mask", "stop-color"].includes(name) &&
          !/^(?:none|currentColor|transparent|[a-zA-Z]+|#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|url\(#[\w-]+\))$/.test(
            value,
          )) ||
        !attrs.has(name) ||
        (/href$/.test(name) && !/^#[\w-]+$/.test(value)) ||
        (/url\s*\(/i.test(value) && !/^url\(#[\w-]+\)$/.test(value))
      )
        $(element).removeAttr(name);
    }
  });
  if ($("svg").length !== 1) throw new LogoError("Unsupported SVG.");
  return Buffer.from($.xml());
}

export async function normalizeLogo(bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > maxLogoBytes)
    throw new LogoError("Choose an image smaller than 2 MB.");
  try {
    let input = bytes;
    if (bytes.length >= 6 && bytes.readUInt32LE(0) === 0x10000) {
      const count = bytes.readUInt16LE(4);
      if (!count || count > 32 || bytes.length < 6 + 16 * count)
        throw new Error("Invalid icon.");
      for (let i = 0; i < count; i++) {
        const offset = bytes.readUInt32LE(6 + i * 16 + 12),
          size = bytes.readUInt32LE(6 + i * 16 + 8);
        if (
          offset < 6 + count * 16 ||
          size < 24 ||
          offset + size > bytes.length
        )
          throw new Error("Invalid icon.");
        const frame = bytes.subarray(offset, offset + size);
        if (frame.readUInt32BE(0) === 0x89504e47) {
          if (frame.readUInt32BE(16) > 512 || frame.readUInt32BE(20) > 512)
            throw new Error("Oversized icon.");
        } else if (
          frame.readUInt32LE(0) < 40 ||
          Math.abs(frame.readInt32LE(4)) > 512 ||
          Math.abs(frame.readInt32LE(8)) > 1024
        )
          throw new Error("Invalid icon bitmap.");
      }
      const icons = await decodeIco(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        "image/png",
      );
      const largest = icons.sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0];
      if (!largest) throw new Error("Invalid icon.");
      input = Buffer.from(largest.buffer);
    } else if (
      !(
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
        /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6)) ||
        (bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP")
      )
    ) {
      input = sanitizeSVG(bytes.toString("utf8"));
    }
    const png = await sharp(input, {
      limitInputPixels: 16_000_000,
      animated: false,
    })
      .rotate()
      .resize(128, 128, { fit: "inside", withoutEnlargement: true })
      .png()
      .timeout({ seconds: 3 })
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    throw new LogoError(
      "Choose a valid PNG, JPG, WebP, GIF, SVG, or ICO image.",
    );
  }
}

export async function normalizeLogoDataURL(value: string | null) {
  if (!value) return null;
  const match =
    /^data:image\/(?:png|jpeg|webp|gif|svg\+xml|x-icon|vnd.microsoft.icon);base64,([A-Za-z0-9+/=]+)$/.exec(
      value,
    );
  if (!match) throw new LogoError("Choose a valid logo image.");
  return normalizeLogo(Buffer.from(match[1]!, "base64"));
}
