import { useEffect, useRef, useState } from "react";
import { readTextPreview } from "../../../lib/read-text-preview";
import type { OfficeFamily } from "../../../lib/office-file-format";
import type { OfficePreviewData } from "../../../lib/read-office-preview";
import { Dialog } from "../../ui/dialog";

const tones = { "Plain text": "bg-surface-3 text-ink-2", JSON: "bg-accent-soft text-accent-ink", Word: "bg-accent-soft text-accent-ink", Excel: "bg-ok-soft text-ok", PowerPoint: "bg-warn-soft text-warn" };
type Preview = NonNullable<Awaited<ReturnType<typeof readTextPreview>>> | Exclude<OfficePreviewData, { kind: "image" }> | { kind: "image"; url: string };

function Contents({ preview, miniature }: { preview: Preview; miniature?: boolean }) {
  if (preview.kind === "source") return <pre className="m-0 whitespace-pre-wrap break-words font-mono">{miniature ? preview.text.slice(0, 600) : preview.text}</pre>;
  if (preview.kind === "image") return <img src={preview.url} alt="" className="mx-auto block max-h-full max-w-full object-contain" />;
  if (preview.kind === "sheet") {
    return <table className="w-full border-collapse text-left">
      <tbody>{preview.rows.slice(0, miniature ? 8 : undefined).map((row, i) =>
        <tr key={i} className={i % 2 ? "bg-surface-2" : ""}>{row.map((v, j) =>
          <td key={j} className="max-w-48 break-words border border-solid border-line px-[.5em] py-[.25em]">{v}</td>
        )}</tr>
      )}</tbody>
    </table>;
  }
  return <>{preview.paragraphs.slice(0, miniature ? 9 : undefined).map((p, i) =>
    <p key={i} className={i === 0 ? "m-0 mb-[.6em] font-semibold" : "m-0 mb-[.45em]"}>{p}</p>
  )}</>;
}

export function DocumentFilePreview({ family, extension, name, src, size }: {
  family: OfficeFamily | "Plain text" | "JSON";
  extension: string;
  name: string;
  src?: string | undefined;
  size: number;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPreview(null);
    setLoading(false);
    if (!src || !button.current) return;
    if (family !== "Plain text" && family !== "JSON" && (size > 50 * 1024 * 1024 || !/[XMB]$/.test(extension))) return;
    const controller = new AbortController();
    const { signal } = controller;
    let imageURL: string | undefined;
    async function load(url: string) {
      setLoading(true);
      try {
        if (family === "Plain text" || family === "JSON") {
          const data = await readTextPreview(url, signal);
          if (!signal.aborted) setPreview(data);
          return;
        }
        const { readOfficePreview } = await import("../../../lib/read-office-preview");
        const response = await fetch(url, { signal });
        if (!response.ok) return;
        const data = await readOfficePreview(await response.blob(), family, signal);
        if (signal.aborted || !data) return;
        if (data.kind === "image") {
          imageURL = URL.createObjectURL(data.blob);
          setPreview({ kind: "image", url: imageURL });
        } else setPreview(data);
      } catch {
        // An encrypted or unreadable attachment still has its original download.
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        void load(src);
      }
    }, { rootMargin: "160px" });
    observer.observe(button.current);
    return () => {
      observer.disconnect();
      controller.abort();
      if (imageURL) URL.revokeObjectURL(imageURL);
    };
  }, [src, family, extension, size]);

  return <>
    <button ref={button} type="button" aria-label={`Preview ${name}`} title={`Preview ${name}`}
      className="relative block size-full overflow-hidden rounded-lg bg-surface-2 text-ink focus-visible:outline-accent"
      onClick={() => setOpen(true)}>
      {preview && <div aria-hidden="true" className="absolute inset-x-[8%] top-2 h-full overflow-hidden rounded-t-sm bg-surface p-[6%] text-left text-[8px] leading-snug shadow-soft">
        <Contents preview={preview} miniature />
      </div>}
      <span className={`inline-flex rounded px-1.5 py-0.5 text-2xs font-semibold ${tones[family]} ${preview ? "absolute bottom-1.5 left-1.5" : ""}`}>{family}</span>
    </button>
    {open && <Dialog title={name} onClose={() => setOpen(false)} size="lg">
      {preview ? <div className="overflow-auto break-words text-sm text-ink"><Contents preview={preview} /></div>
        : <p role="status" className="text-sm text-ink-2">{loading ? "Loading preview…" : "A preview isn’t available for this file."}</p>}
      {src && <div className="mt-4 flex items-center justify-between gap-3 pt-3 hairline-t">
        <span className="text-xs text-ink-2">{extension}{preview?.kind === "source" && preview.truncated ? " · First 64 KiB" : preview && " · Preview"}</span>
        <a href={src} download={name} className="text-sm font-medium text-accent-ink hover:underline">Download original</a>
      </div>}
    </Dialog>}
  </>;
}
