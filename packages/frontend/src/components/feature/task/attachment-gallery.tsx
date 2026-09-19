import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { filePreviewKind, projectFileURL, type ProjectFileSummary } from "@spectron/shared";
import { IconButton } from "../../ui/button";
import { Icon } from "../../ui/icon";
import type { IssueFileActions } from "./issue-files";

const GalleryContext = createContext<((file: ProjectFileSummary) => void) | null>(null);
export const useAttachmentGallery = () => useContext(GalleryContext);

/** Full-screen viewer for issue attachments with keyboard navigation and zoom. */
export function AttachmentGallery({ children, projectId, issueId, actions }: {
  children: ReactNode; projectId: string; issueId: string; actions: IssueFileActions;
}) {
  const [files, setFiles] = useState<ProjectFileSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const request = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const index = files.findIndex(f => f.projectFileId === selected);
  const file = files[index];
  const close = () => { request.current++; setSelected(null); };
  useEffect(() => { close(); return () => { request.current++; }; }, [projectId, issueId]);
  useEffect(() => { setZoom(1); viewport.current?.scrollTo(0, 0); setError(""); }, [selected]);
  function navigate(direction: number) {
    if (files.length > 1) setSelected(files[(index + direction + files.length) % files.length]!.projectFileId);
  }
  useEffect(() => {
    if (!selected) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLMediaElement) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navigate(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selected, files]);
  const open = (clicked: ProjectFileSummary) => {
    const version = ++request.current;
    setFiles([clicked]); setSelected(clicked.projectFileId); setError("");
    void actions.list(projectId, issueId).then(rows => {
      if (version !== request.current) return;
      setFiles(rows.some(f => f.projectFileId === clicked.projectFileId) ? rows : [clicked, ...rows]);
    }).catch(() => { if (version === request.current) setError("Could not load the other attachments. Close and reopen to retry."); });
  };
  const kind = file ? filePreviewKind(file.contentType) : null;
  const tool = "grid size-8 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30";
  return <GalleryContext.Provider value={open}>
    {children}
    {file && (
      <div role="dialog" aria-modal="true" aria-label={file.filename} className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className="flex h-14 items-center gap-1 px-3">
          <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium">{file.filename}</span>
          {kind === "image" && <>
            <button type="button" className={tool} aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - .5))}>−</button>
            <button type="button" className="mono h-8 rounded-md px-2 text-xs text-white/80 hover:bg-white/10" onClick={() => setZoom(1)} aria-label="Fit image">{Math.round(zoom * 100)}%</button>
            <button type="button" className={tool} aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(z => Math.min(4, z + .5))}>+</button>
          </>}
          <a href={projectFileURL(file.projectId, file.projectFileId, true)} className={tool} aria-label="Download" title="Download"><Icon name="download" size={16} /></a>
          <button type="button" className={tool} aria-label="Close" onClick={close}><Icon name="close" size={16} /></button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {files.length > 1 && (
            <>
              <button type="button" aria-label="Previous attachment" className="absolute top-1/2 left-3 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20" onClick={() => navigate(-1)}><Icon name="back" size={18} /></button>
              <button type="button" aria-label="Next attachment" className="absolute top-1/2 right-3 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20" onClick={() => navigate(1)}><Icon name="chevron-right" size={18} /></button>
            </>
          )}
          <div className="size-full overflow-auto p-4" ref={viewport} tabIndex={0} aria-label="Attachment preview">
            {kind === "image" ? (
              <div className="grid min-h-full place-items-center" style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
                <img key={file.projectFileId} src={projectFileURL(file.projectId, file.projectFileId)} alt={file.filename} onError={() => setError("Could not load this image.")} className="max-h-full max-w-full rounded-md object-contain" style={{ cursor: zoom === 1 ? "zoom-in" : "zoom-out", ...(zoom > 1 ? { maxWidth: "none", width: "100%", maxHeight: "none" } : {}) }} onClick={() => setZoom(z => z === 1 ? 2 : 1)} />
              </div>
            ) : kind === "video" ? (
              <div className="grid size-full place-items-center"><video key={file.projectFileId} controls autoPlay src={projectFileURL(file.projectId, file.projectFileId)} className="max-h-full max-w-full rounded-md" /></div>
            ) : kind === "audio" ? (
              <div className="grid size-full place-items-center"><audio key={file.projectFileId} controls autoPlay src={projectFileURL(file.projectId, file.projectFileId)} /></div>
            ) : (
              <div className="grid size-full place-items-center">
                <div className="flex flex-col items-center gap-3 rounded-xl bg-white/5 px-10 py-8 text-center">
                  <Icon name="file" size={40} className="text-white/70" />
                  <p className="text-sm">{file.filename}</p>
                  <a href={projectFileURL(file.projectId, file.projectFileId, true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium text-black"><Icon name="download" size={14} />Download file</a>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex h-10 items-center justify-center gap-2 text-xs text-white/60">
          <span aria-live="polite">{index + 1} / {files.length}</span>
          {error && <span role="alert" className="text-bad">{error}</span>}
        </div>
      </div>
    )}
  </GalleryContext.Provider>;
}
