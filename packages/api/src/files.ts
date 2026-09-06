import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { z } from "zod";
import { applicationIdPattern, filePreviewKind } from "@spectron/shared";
import {
  FileInputError,
  FileSizeError,
  FileUnavailableError,
  ProjectAccessError,
  type Auth,
  type FileService,
} from "@spectron/backend";

const id = z.union([z.string().regex(applicationIdPattern), z.uuid()]);
function disposition(filename: string, inline: boolean) {
  const fallback = filename.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
export function createFileRoutes(
  auth: Auth,
  files: FileService,
  appURL: string,
) {
  const routes = new Hono();
  routes.onError((error, c) => {
    c.header("Cache-Control", "no-store");
    if (error instanceof ProjectAccessError)
      return c.json({ error: error.message }, 404);
    if (error instanceof FileSizeError)
      return c.json({ error: error.message }, 413);
    if (error instanceof FileInputError || error instanceof z.ZodError)
      return c.json(
        {
          error:
            error instanceof z.ZodError
              ? "Invalid file request."
              : error.message,
        },
        400,
      );
    if (error instanceof FileUnavailableError)
      return c.json({ error: error.message }, 503);
    console.error("File operation failed.");
    return c.json(
      { error: "Could not complete the file operation. Please try again." },
      500,
    );
  });
  routes.post("/upload", async (c) => {
    if (c.req.header("origin") !== appURL)
      return c.json({ error: "Invalid origin" }, 403);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const projectId = id.parse(c.req.query("projectId"));
    const filename = z.string().min(1).max(1024).parse(c.req.query("filename"));
    if (!c.req.raw.body) throw new FileInputError("Select a file to upload.");
    const length = c.req.header("content-length");
    const result = await files.upload(
      session.user.id,
      projectId,
      filename,
      c.req.raw.body,
      length === undefined ? undefined : Number(length),
    );
    return c.json(result, 201);
  });
  routes.on(["GET", "HEAD"], "/:projectId/:projectFileId", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    const projectId = id.parse(c.req.param("projectId"));
    const projectFileId = id.parse(c.req.param("projectFileId"));
    const file = await files.download(
      session.user.id,
      projectId,
      projectFileId,
    );
    const headers = new Headers({
      "Content-Type": file.contentType,
      "Content-Disposition": disposition(
        file.filename,
        filePreviewKind(file.contentType) !== null &&
          c.req.query("download") !== "1",
      ),
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Referrer-Policy": "no-referrer",
    });
    if (files.delivery === "nginx") {
      headers.set("X-Accel-Redirect", `/_protected_files/${file.storageKey}`);
      return new Response(null, { headers });
    }
    const etag = `"${file.id}"`;
    headers.set("ETag", etag);
    headers.set("Accept-Ranges", "bytes");
    const matches = c.req
      .header("if-none-match")
      ?.split(",")
      .map((v) => v.trim().replace(/^W\//, ""));
    if (matches?.includes(etag) || matches?.includes("*"))
      return new Response(null, { status: 304, headers });
    let start = 0,
      end = file.sizeBytes - 1,
      status = 200;
    const range = c.req.header("range"),
      ifRange = c.req.header("if-range");
    if (range && c.req.method !== "HEAD" && (!ifRange || ifRange === etag)) {
      const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!parsed || (!parsed[1] && !parsed[2])) {
        headers.set("Content-Range", `bytes */${file.sizeBytes}`);
        return new Response(null, { status: 416, headers });
      }
      if (!parsed[1]) start = Math.max(0, file.sizeBytes - Number(parsed[2]));
      else {
        start = Number(parsed[1]);
        if (parsed[2]) end = Math.min(end, Number(parsed[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= file.sizeBytes
      ) {
        headers.set("Content-Range", `bytes */${file.sizeBytes}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${file.sizeBytes}`);
      status = 206;
    }
    headers.set("Content-Length", String(end - start + 1));
    return new Response(
      c.req.method === "HEAD"
        ? null
        : (Readable.toWeb(
            createReadStream(file.path, { start, end }),
          ) as ReadableStream<Uint8Array>),
      { status, headers },
    );
  });
  return routes;
}
