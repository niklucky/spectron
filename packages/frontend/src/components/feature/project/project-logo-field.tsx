import { useEffect, useRef, useState } from "react";
import { normalizeProjectURL } from "@spectron/shared";
import { Button } from "../../ui/button";

export function ProjectLogoField({
  url,
  logo,
  initial,
  onChange,
  onBusyChange,
  onDiscover,
  preserveInitial = false,
}: {
  preserveInitial?: boolean;
  url: string;
  logo: string | null;
  initial: string;
  onChange: (logo: string | null) => void;
  onBusyChange: (busy: boolean) => void;
  onDiscover: (url: string) => Promise<{ logo: string | null }>;
}) {
  const [mode, setMode] = useState<"auto" | "upload" | "removed" | "saved">(
    preserveInitial ? "saved" : "auto",
  );
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onChange, onBusyChange, onDiscover });
  callbacks.current = { onChange, onBusyChange, onDiscover };
  const previousURL = useRef(url);
  useEffect(() => {
    const changed = previousURL.current !== url;
    previousURL.current = url;
    if (mode === "upload") return;
    if (mode === "removed" || mode === "saved") {
      if (changed) setMode("auto");
      return;
    }
    const request = ++generation.current;
    callbacks.current.onChange(null);
    callbacks.current.onBusyChange(false);
    setStatus("");
    let normalized: string | null;
    try {
      normalized = normalizeProjectURL(url);
    } catch {
      return;
    }
    if (!normalized) return;
    callbacks.current.onBusyChange(true);
    const timer = window.setTimeout(async () => {
      setStatus("Looking for an icon…");
      try {
        const result = await callbacks.current.onDiscover(normalized!);
        if (request !== generation.current) return;
        callbacks.current.onChange(result.logo);
        setStatus(
          result.logo
            ? "Website icon found"
            : "No icon found. You can upload a logo.",
        );
      } catch {
        if (request === generation.current)
          setStatus("Couldn’t find an icon. You can upload a logo.");
      } finally {
        if (request === generation.current)
          callbacks.current.onBusyChange(false);
      }
    }, 700);
    return () => {
      clearTimeout(timer);
      if (generation.current === request) generation.current++;
    };
  }, [url, mode]);
  return (
    <div className="project-logo-field">
      <span className="project-field-label">Logo</span>
      <div className="project-logo-controls">
        <span className="project-logo-preview">
          {logo ? (
            <img src={logo} alt="Project logo preview" />
          ) : (
            <span aria-hidden="true">{initial}</span>
          )}
        </span>
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          Upload image
        </Button>
        {(logo || status) && (
          <Button
            variant="ghost"
            onClick={() => {
              generation.current++;
              setMode("removed");
              onChange(null);
              onBusyChange(false);
              setStatus("");
            }}
          >
            Remove
          </Button>
        )}
        <input
          ref={fileRef}
          className="project-logo-file"
          type="file"
          aria-label="Upload project logo"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              setStatus("Choose an image smaller than 2 MB.");
              return;
            }
            const request = ++generation.current;
            setMode("upload");
            onBusyChange(true);
            setStatus("Loading image…");
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              const mime =
                file.type ||
                (/\.svg$/i.test(file.name)
                  ? "image/svg+xml"
                  : /\.ico$/i.test(file.name)
                    ? "image/x-icon"
                    : "image/png");
              const imageURL = data.replace(/^data:[^;]+;/, `data:${mime};`);
              const image = new Image();
              image.src = imageURL;
              await image.decode();
              if (image.naturalWidth * image.naturalHeight > 16_000_000)
                throw new Error("Image too large.");
              if (request !== generation.current) return;
              onChange(imageURL);
              setStatus("Uploaded logo");
            } catch {
              if (request === generation.current)
                setStatus("This image couldn’t be read. Try another file.");
            } finally {
              if (request === generation.current) onBusyChange(false);
            }
          }}
        />
      </div>
      <p className="project-logo-status" role="status">
        {status || "PNG, JPG, WebP, GIF, SVG or ICO · Up to 2 MB"}
      </p>
    </div>
  );
}
