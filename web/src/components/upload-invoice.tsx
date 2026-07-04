"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function UploadInvoice() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleFile(file: File) {
    setPending(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/invoices", { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      setMessage(`Upload failed: ${json?.error ?? res.statusText}`);
      return;
    }
    setMessage(`Received — Clara is reading it (${json.id.slice(0, 8)}…)`);
    router.refresh();
    // Extraction takes a few seconds; refresh once more so the row updates.
    setTimeout(() => router.refresh(), 12_000);
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload invoice"}
      </button>
      {message && <span className="text-sm text-zinc-500">{message}</span>}
    </div>
  );
}
