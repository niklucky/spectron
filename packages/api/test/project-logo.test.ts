import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProjectURL } from "@spectron/shared";
import {
  iconCandidates,
  discoverProjectLogo,
} from "../../backend/src/project-logo/discovery";
import {
  normalizeLogo,
  normalizeLogoDataURL,
} from "../../backend/src/project-logo/images";
import {
  isPublicAddress,
  validatePublicURL,
  fetchPublicFile,
  type FetchRemote,
} from "../../backend/src/project-logo/safe-fetch";

const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#3276ef"/></svg>',
);

test("website URL normalization accepts domains and rejects unsafe schemes and credentials", () => {
  assert.equal(
    normalizeProjectURL(" example.com/path#top "),
    "https://example.com/path",
  );
  assert.equal(normalizeProjectURL(""), null);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:password@example.com",
    "not a domain",
  ])
    assert.throws(() => normalizeProjectURL(url));
});

test("HTML discovery resolves declared icons, base URLs and the final page URL", () => {
  assert.deepEqual(
    iconCandidates(
      '<base href="/assets/"><link rel="apple-touch-icon" href="apple.png"><link rel="shortcut ICON" sizes="32x32" href="small.png"><link rel="icon" sizes="128x128" href="//cdn.example.com/logo.svg"><link rel="icon" href="data:image/png;base64,123">',
      "https://example.com/redirected/page",
    ),
    [
      "https://cdn.example.com/logo.svg",
      "https://example.com/assets/small.png",
      "https://example.com/assets/apple.png",
      "https://example.com/favicon.ico",
    ],
  );
});

test("image normalization resizes SVG, strips external content and returns a PNG", async () => {
  const result = await normalizeLogo(svg);
  const png = Buffer.from(result.split(",")[1]!, "base64");
  assert.equal(png.readUInt32BE(0), 0x89504e47);
  assert.equal(png.readUInt32BE(16), 128);
  assert.equal(png.readUInt32BE(20), 128);
  const unsafe = svg
    .toString()
    .replace(
      "<rect",
      '<script>alert(1)</script><image href="file:///etc/passwd"/><rect',
    );
  assert.equal(await normalizeLogo(Buffer.from(unsafe)), result);
  assert.equal(
    await normalizeLogo(Buffer.from(`<!-- leading comment -->${svg}`)),
    result,
  );
  assert.equal(await normalizeLogoDataURL(result), result);
  assert.equal(await normalizeLogoDataURL(null), null);
  await assert.rejects(
    normalizeLogo(
      Buffer.from(
        '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
      ),
    ),
  );
  await assert.rejects(normalizeLogo(Buffer.from("not an image")));
  await assert.rejects(normalizeLogo(Buffer.alloc(2 * 1024 * 1024 + 1)));
  await assert.rejects(normalizeLogoDataURL("https://example.com/image.png"));
});

test("ICO with an embedded PNG is decoded; invalid frame sizes are rejected", async () => {
  const pngURL = await normalizeLogo(svg);
  const png = Buffer.from(pngURL.split(",")[1]!, "base64");
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 128;
  header[7] = 128;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  assert.equal(await normalizeLogo(Buffer.concat([header, png])), pngURL);
  header.writeUInt32LE(0xffffffff, 14);
  await assert.rejects(normalizeLogo(Buffer.concat([header, png])));
});

test("discovery skips invalid icons, uses fallback and handles unavailable sites", async () => {
  const requested: string[] = [];
  const fetcher: FetchRemote = async (url) => {
    requested.push(url);
    return {
      url,
      contentType: "text/html",
      body: url.endsWith("/favicon.ico")
        ? svg
        : Buffer.from('<link rel="icon" href="/broken.png">'),
    };
  };
  assert.ok(
    (
      await discoverProjectLogo("https://example.com/", fetcher)
    ).logo?.startsWith("data:image/png;base64,"),
  );
  assert.deepEqual(requested, [
    "https://example.com/",
    "https://example.com/broken.png",
    "https://example.com/favicon.ico",
  ]);
  assert.deepEqual(
    await discoverProjectLogo("https://example.com", async () => {
      throw new Error("Offline");
    }),
    { logo: null },
  );
});

test("remote fetching rejects private, loopback, reserved and mapped addresses", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "198.18.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "http://example.com:3001",
  ])
    assert.throws(() => validatePublicURL(url));
  // These are rejected after DNS resolution, before any socket is opened.
  for (const url of [
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://[::ffff:127.0.0.1]/",
  ])
    await assert.rejects(
      fetchPublicFile(url, AbortSignal.timeout(1000)),
      /publicly accessible/,
    );
});
