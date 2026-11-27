import { useEffect, useId, useRef, useState } from "react";
import { Avatar, type AvatarKind } from "../../ui/avatar";
import { Button } from "../../ui/button";
import { Dialog, DialogFooter } from "../../ui/dialog";

type Position = { x: number; y: number };
// Offsets are fractions of the square preview so the same crop scales to the saved image.
type Crop = Position & { zoom: number };
const center = { x: 0, y: 0, zoom: 1 };
const maxFileBytes = 2 * 1024 * 1024;
const avatarSize = 128;

function cropSize(image: HTMLImageElement, zoom: number) {
  const scale = zoom / Math.min(image.naturalWidth, image.naturalHeight);
  return {
    width: image.naturalWidth * scale,
    height: image.naturalHeight * scale,
  };
}

function clampCrop(image: HTMLImageElement, crop: Crop): Crop {
  const { width, height } = cropSize(image, crop.zoom);
  const clamp = (offset: number, span: number) => {
    const limit = Math.max(0, (span - 1) / 2);
    return Math.max(-limit, Math.min(limit, offset));
  };
  return { x: clamp(crop.x, width), y: clamp(crop.y, height), zoom: crop.zoom };
}

function drawCrop(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  crop: Crop,
  size: number,
) {
  const { width, height } = cropSize(image, crop.zoom);
  ctx.drawImage(
    image,
    (0.5 + crop.x - width / 2) * size,
    (0.5 + crop.y - height / 2) * size,
    width * size,
    height * size,
  );
}

export function AvatarField({
  name,
  image,
  onChange,
  kind,
  disabled,
}: {
  name: string;
  image: string | null;
  onChange: (image: string | null) => void;
  kind?: AvatarKind;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  return (
    <div>
      <div className="mb-2 text-sm font-medium">Avatar</div>
      <div className="flex flex-wrap items-center gap-2">
        <Avatar name={name} image={image} kind={kind} size="xl" />
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {image ? "Change image" : "Upload image"}
        </Button>
        {image && (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setError("");
              onChange(null);
            }}
          >
            Remove avatar
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        disabled={disabled}
        aria-label="Choose avatar image"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (!selected) return;
          if (selected.size > maxFileBytes) {
            setError("Choose an image up to 2 MB.");
            return;
          }
          setError("");
          setFile(selected);
        }}
      />
      {error && (
        <p className="mt-2 text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      {file && (
        <AvatarCropDialog
          file={file}
          onClose={() => setFile(null)}
          onApply={(cropped) => {
            onChange(cropped);
            setFile(null);
          }}
        />
      )}
    </div>
  );
}

const moves: Record<string, Position | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function AvatarCropDialog({
  file,
  onClose,
  onApply,
}: {
  file: File;
  onClose: () => void;
  onApply: (image: string) => void;
}) {
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; crop: Crop } | null>(
    null,
  );
  const hintId = useId();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>(center);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const source = new Image();
    let active = true;
    source.src = url;
    void source
      .decode()
      .then(() => {
        if (!active) return;
        if (!source.naturalWidth || !source.naturalHeight)
          throw new Error("Empty image.");
        if (source.naturalWidth * source.naturalHeight > 16_000_000) {
          setError("Choose an image under 16 megapixels.");
        } else {
          setImage(source);
        }
      })
      .catch(() => {
        if (active)
          setError("This image couldn’t be read. Choose a different image.");
      });
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    const canvas = preview.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCrop(ctx, image, crop, canvas.width);
  }, [image, crop]);

  function applyCrop() {
    if (!image) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = avatarSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error();
      ctx.imageSmoothingQuality = "high";
      ctx.arc(avatarSize / 2, avatarSize / 2, avatarSize / 2, 0, 2 * Math.PI);
      ctx.clip();
      drawCrop(ctx, image, crop, avatarSize);
      onApply(canvas.toDataURL("image/png"));
    } catch {
      setError("Couldn’t crop this image. Choose a different image.");
    }
  }

  return (
    <Dialog title="Crop avatar" size="sm" onClose={onClose}>
      {image ? (
        <div className="mx-auto grid w-full max-w-72 gap-3">
          <div
            className="relative aspect-square touch-none cursor-grab overflow-hidden rounded-lg bg-surface-3 outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
            tabIndex={0}
            role="group"
            aria-label="Position avatar image"
            aria-describedby={hintId}
            onKeyDown={(event) => {
              const move = moves[event.key];
              if (!move) return;
              event.preventDefault();
              setCrop((current) =>
                clampCrop(image, {
                  ...current,
                  x: current.x + move.x * 0.025,
                  y: current.y + move.y * 0.025,
                }),
              );
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                crop,
              };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.id !== event.pointerId) return;
              const size = event.currentTarget.getBoundingClientRect().width;
              setCrop(
                clampCrop(image, {
                  ...start.crop,
                  x: start.crop.x + (event.clientX - start.x) / size,
                  y: start.crop.y + (event.clientY - start.y) / size,
                }),
              );
            }}
            onLostPointerCapture={(event) => {
              if (drag.current?.id === event.pointerId) drag.current = null;
            }}
          >
            <canvas
              ref={preview}
              width={576}
              height={576}
              className="size-full"
              aria-hidden="true"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full border border-white/80 shadow-[0_0_0_200px_rgb(0_0_0/0.6)]"
            />
          </div>
          <p id={hintId} className="text-sm text-ink-3">
            Drag or use arrow keys to position.
          </p>
          <label className="grid gap-1 text-sm">
            Zoom
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={crop.zoom}
              className="w-full accent-accent"
              onChange={(event) => {
                const zoom = event.target.valueAsNumber;
                setCrop((current) => clampCrop(image, { ...current, zoom }));
              }}
            />
          </label>
        </div>
      ) : (
        !error && <p role="status">Loading image…</p>
      )}
      {error && (
        <p className="mt-2 text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!image || !!error} onClick={applyCrop}>
          Apply crop
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
