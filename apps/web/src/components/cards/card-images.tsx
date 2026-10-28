import { type ImageReference, imageMarkdown, imageReferencesIn } from "@banki/shared";
import { ImageOff, ImagePlus, LoaderCircle, X } from "lucide-react";
import { useRef, useState } from "react";
import { FormError } from "@/components/auth-card";
import { OUTLINE_PILL } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { IMAGE_ACCEPT, imageUrl, uploadImage } from "@/lib/images";
import { cn } from "@/lib/utils";

// Images on the writing page: "Add image" in the card's foot uploads the files
// picked and puts a reference to each in the side written last, and under
// each side a strip of thumbnails of the Images its text refers to.

/** An upload that failed or was refused: the file's name and the message to show. */
export type UploadFailure = { name: string; message: string };

/**
 * Uploads several files at once and hands each one's Markdown to `insert`
 * in the order they were picked, as they finish: one that finishes early waits
 * for those before it. One that fails is skipped and collected as a failure.
 */
export function useImageUploads(insert: (markdown: string) => void) {
  const [pending, setPending] = useState(0);
  const [failures, setFailures] = useState<UploadFailure[]>([]);
  const pick = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setFailures([]);
    setPending((n) => n + files.length);
    const uploads = files.map((file) => uploadImage(file));
    for (const [i, upload] of uploads.entries()) {
      const outcome = await upload;
      setPending((n) => n - 1);
      if (outcome.ok) insert(imageMarkdown(outcome.reference));
      else setFailures((f) => [...f, { name: files[i]?.name ?? "", message: outcome.message }]);
    }
  };
  return { uploading: pending > 0, failures, pick };
}

/** "Add image": opens the file picker for one or several images; "Uploading…" while it does. */
export function AddImageButton({
  uploading,
  disabled,
  onPick,
}: {
  uploading: boolean;
  disabled: boolean;
  onPick: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // Cleared, so picking the same file again is a change too.
          event.target.value = "";
          onPick(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className={cn(OUTLINE_PILL, "h-11 lg:h-10")}
        disabled={disabled || uploading}
        aria-busy={uploading || undefined}
        onClick={() => input.current?.click()}
      >
        {uploading ? (
          <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : (
          <ImagePlus aria-hidden />
        )}
        {uploading ? "Uploading…" : "Add image"}
      </Button>
    </>
  );
}

/** Each upload that failed, with its file's name, under the form. */
export function UploadFailures({ failures }: { failures: readonly UploadFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {failures.map((failure, i) => (
        // oxlint-disable-next-line no-array-index-key -- the list only ever grows, then clears
        <FormError key={i}>
          <span className="font-medium break-all">{failure.name}</span>: {failure.message}
        </FormError>
      ))}
    </div>
  );
}

/**
 * The thumbnails of the Images `markdown` refers to, in the order it refers
 * to them, nothing when it refers to none. Each opens the Image full size in a
 * new tab, and its × hands its reference to `onRemove`, unless `readOnly`. A
 * reference to an Image that doesn't exist shows a "missing image" tile.
 */
export function ImageStrip({
  markdown,
  readOnly,
  onRemove,
}: {
  markdown: string;
  readOnly: boolean;
  onRemove: (ref: ImageReference) => void;
}) {
  const refs = imageReferencesIn(markdown);
  if (refs.length === 0) return null;
  const seen = new Map<string, number>();
  return (
    <ul aria-label="Images" className="flex flex-wrap gap-4 pt-2">
      {refs.map((ref, i) => {
        // The same Image twice gets a key of its own each time, kept as text around it changes.
        const nth = (seen.get(ref.file) ?? 0) + 1;
        seen.set(ref.file, nth);
        return (
          <Thumbnail
            key={`${ref.file}#${nth}`}
            file={ref.file}
            n={i + 1}
            readOnly={readOnly}
            onRemove={() => onRemove(ref)}
          />
        );
      })}
    </ul>
  );
}

const TILE = "flex size-16 overflow-hidden rounded-lg border bg-muted";

function Thumbnail({
  file,
  n,
  readOnly,
  onRemove,
}: {
  file: string;
  n: number;
  readOnly: boolean;
  onRemove: () => void;
}) {
  const [missing, setMissing] = useState(false);
  return (
    <li className="relative">
      {missing ? (
        <div
          role="img"
          aria-label={`Image ${n}: missing image`}
          className={cn(
            TILE,
            "flex-col items-center justify-center gap-0.5 border-dashed bg-transparent text-muted-foreground",
          )}
        >
          <ImageOff aria-hidden className="size-4" />
          <span className="text-[0.65rem] leading-tight">Missing</span>
        </div>
      ) : (
        <a
          href={imageUrl(file)}
          target="_blank"
          rel="noopener"
          aria-label={`Open image ${n} in a new tab`}
          className={cn(
            TILE,
            "hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          <img
            src={imageUrl(file)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={() => setMissing(true)}
          />
        </a>
      )}
      {!readOnly && (
        // A 44 px target below 1024 px around a small round ×, on the tile's corner.
        <button
          type="button"
          aria-label="Remove image"
          onClick={onRemove}
          className="group/remove absolute -top-3.5 -right-3.5 flex size-11 items-center justify-center rounded-full outline-none lg:-top-2.5 lg:-right-2.5 lg:size-7"
        >
          <span className="flex size-6 items-center justify-center rounded-full border bg-background text-foreground shadow-xs group-hover/remove:bg-muted group-focus-visible/remove:outline-2 group-focus-visible/remove:outline-offset-1 group-focus-visible/remove:outline-ring">
            <X aria-hidden className="size-3.5" />
          </span>
        </button>
      )}
    </li>
  );
}
