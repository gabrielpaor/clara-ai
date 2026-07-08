"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function UploadInvoice() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<React.ReactNode>(null);
  const [pending, setPending] = useState(false);

  async function handleFiles(files: File[]) {
    setPending(true);
    setMessage(null);

    const isBatch =
      files.length > 1 ||
      files.some((f) => f.type.includes("zip") || f.name.toLowerCase().endsWith(".zip"));

    let res: Response;
    if (isBatch) {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      res = await fetch("/api/batches", { method: "POST", body: form });
    } else {
      const form = new FormData();
      form.append("file", files[0]);
      res = await fetch("/api/invoices", { method: "POST", body: form });
    }

    const json = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      setMessage(`Upload failed: ${json?.error ?? res.statusText}`);
      return;
    }

    if (isBatch) {
      setMessage(
        <>
          Batch received — {json.invoiceCount} invoice(s) queued.{" "}
          <Link href={`/invoices?batch=${json.batchId}`} className="underline">
            Track the batch →
          </Link>
        </>,
      );
    } else {
      setMessage(`Received — Clara is reading it (${json.id.slice(0, 8)}…)`);
      // Extraction takes a few seconds; refresh once more so the row updates.
      setTimeout(() => router.refresh(), 12_000);
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp,.zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void handleFiles(files);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload invoices"}
      </button>
      {message && <span className="text-sm text-zinc-500">{message}</span>}
    </div>
  );
}
