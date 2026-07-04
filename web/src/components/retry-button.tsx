"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetryButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/retry`, {
      method: "POST",
    });
    setPending(false);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? "Retry failed");
      return;
    }
    router.refresh();
    // Extraction takes a few seconds; refresh again so the outcome shows.
    setTimeout(() => router.refresh(), 12_000);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={retry}
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Retrying…" : "Retry extraction"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
