"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewActions({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "approve" | "reject") {
    let body: Record<string, string> = {};
    if (kind === "reject") {
      const reason = window.prompt("Why is this invoice being rejected?");
      if (!reason || reason.trim().length < 3) return;
      body = { reason: reason.trim() };
    }
    setPending(kind);
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(null);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? "Action failed");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => act("approve")}
        disabled={pending !== null}
        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
      >
        {pending === "approve" ? "Approving…" : "Approve"}
      </button>
      <button
        onClick={() => act("reject")}
        disabled={pending !== null}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
      >
        {pending === "reject" ? "Rejecting…" : "Reject"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
