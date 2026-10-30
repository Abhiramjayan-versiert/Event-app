"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { publicStorageUrl, safeFileName, UPLOAD_LIMITS } from "@/lib/storage";
import type { ActionResult } from "@/lib/actions";
import { cn } from "@/lib/utils";

/**
 * Uploads an image to the public `branding` bucket under `{folder}/` (storage
 * RLS checks the user may manage that college/event), then persists the path.
 */
export function BrandingUploader({
  folder, currentPath, onSaved, label = "Logo", aspect = "square",
}: {
  folder: string;
  currentPath: string | null;
  onSaved: (path: string | null) => Promise<ActionResult>;
  label?: string;
  aspect?: "square" | "banner";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState(currentPath);
  const [busy, setBusy] = useState(false);
  const url = publicStorageUrl("branding", path);

  async function upload(file: File) {
    const limits = UPLOAD_LIMITS.branding;
    if (!(limits.types as readonly string[]).includes(file.type)) return toast.error("Use a PNG, JPG, WebP or SVG image.");
    if (file.size > limits.maxBytes) return toast.error("Images must be 5 MB or smaller.");
    setBusy(true);
    const objectPath = `${folder}/${Date.now()}-${safeFileName(file.name)}`;
    const { error } = await createClient().storage.from("branding").upload(objectPath, file, { contentType: file.type, upsert: false });
    if (error) {
      setBusy(false);
      return toast.error("Upload failed. You may not have permission to change this image.");
    }
    const result = await onSaved(objectPath);
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    setPath(objectPath);
    toast.success(`${label} updated`);
  }

  async function remove() {
    setBusy(true);
    const result = await onSaved(null);
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    setPath(null);
  }

  return (
    <div className="flex items-center gap-4">
      <div className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted", aspect === "square" ? "size-16" : "h-16 w-40")}>
        {url ? <Image src={url} alt={label} fill className="object-cover" sizes="160px" unoptimized /> : <ImageUp className="size-5 text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept={UPLOAD_LIMITS.branding.types.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => input.current?.click()}>
          {path ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
        </Button>
        {path ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
            <Trash2 /> Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
