import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { filePreviewKind, projectFileURL, type ProjectFileSummary } from "@spectron/shared";
import { Dialog } from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Icon } from "../../ui/icon";
import type { IssueFileActions } from "./issue-files";

const GalleryContext = createContext<((file: ProjectFileSummary) => void) | null>(null);
export const useAttachmentGallery = () => useContext(GalleryContext);

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
  return <GalleryContext.Provider value={open}>
    {children}
    {file && <Dialog title={file.filename} onClose={close} className="attachment-gallery">
      <div>
        <div className="gallery-toolbar">
          <Button variant="ghost" aria-label="Previous attachment" disabled={files.length < 2} onClick={() => navigate(-1)}>‹</Button>
          <span aria-live="polite">{index + 1} / {files.length}</span>
          <Button variant="ghost" aria-label="Next attachment" disabled={files.length < 2} onClick={() => navigate(1)}>›</Button>
          {kind === "image" && <>
            <Button variant="ghost" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - .5))}>−</Button>
            <Button variant="ghost" onClick={() => setZoom(1)} aria-label="Fit image">{Math.round(zoom * 100)}%</Button>
            <Button variant="ghost" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(z => Math.min(4, z + .5))}>+</Button>
          </>}
          <a href={projectFileURL(file.projectId, file.projectFileId, true)} className="gallery-download"><Icon name="download" size={18} /> Download</a>
        </div>
        <div className="gallery-viewport" ref={viewport} tabIndex={0} aria-label="Attachment preview">
          {kind === "image" ? <div style={{width: `${zoom * 100}%`, height: `${zoom * 100}%`}}>
            <img key={file.projectFileId} src={projectFileURL(file.projectId, file.projectFileId)} alt={file.filename} onError={() => setError("Could not load this image.")} style={{ cursor: zoom === 1 ? "zoom-in" : "zoom-out" }} onClick={() => setZoom(z => z === 1 ? 2 : 1)} />
          </div> : kind === "video" ? <video key={file.projectFileId} controls src={projectFileURL(file.projectId, file.projectFileId)} />
            : kind === "audio" ? <audio key={file.projectFileId} controls src={projectFileURL(file.projectId, file.projectFileId)} />
            : <div className="gallery-file"><Icon name="file" size={48} /><p>{file.filename}</p><a href={projectFileURL(file.projectId, file.projectFileId, true)}>Download file</a></div>}
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </Dialog>}
  </GalleryContext.Provider>;
}
