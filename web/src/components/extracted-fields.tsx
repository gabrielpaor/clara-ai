"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface FieldValues {
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  dueDate: string | null;
  currency: string | null;
  subtotal: string | null; // fixed-2 strings for display/input
  tax: string | null;
  total: string | null;
}

const LABELS: Record<keyof FieldValues, string> = {
  vendorName: "Vendor (as printed)",
  invoiceNumber: "Invoice #",
  invoiceDate: "Invoice date",
  dueDate: "Due date",
  currency: "Currency",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
};

/** Editable extracted-data panel. View mode by default; reviewers on a
 * NEEDS_REVIEW invoice can switch to edit mode, fix fields, and save —
 * which audits the change and recomputes the sanity flags server-side. */
export function ExtractedFields({
  invoiceId,
  editable,
  initial,
  matchedVendor,
  confidence,
}: {
  invoiceId: string;
  editable: boolean;
  initial: FieldValues;
  matchedVendor: string | null;
  confidence: number | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FieldValues>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);

    // Send only what differs; numbers go as numbers, empties as null.
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(values) as (keyof FieldValues)[]) {
      const raw = values[key]?.trim() ?? "";
      const next = raw === "" ? null : raw;
      if (next === (initial[key] ?? null)) continue;
      if (key === "subtotal" || key === "tax" || key === "total") {
        payload[key] = next === null ? null : Number(next);
      } else {
        payload[key] = next;
      }
    }

    if (Object.keys(payload).length === 0) {
      setEditing(false);
      setPending(false);
      return;
    }

    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setPending(false);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? "Correction failed");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium text-zinc-900">Extracted data</h2>
        <div className="flex items-center gap-3">
          {confidence !== null && (
            <span className="text-sm text-zinc-500">
              Confidence: {Math.round(confidence * 100)}%
            </span>
          )}
          {editable && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg px-3 py-1 text-sm text-zinc-600 ring-1 ring-zinc-300 hover:bg-zinc-100"
            >
              Correct fields
            </button>
          )}
        </div>
      </div>

      {!editing ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-zinc-500">Vendor (matched)</dt>
            <dd className="font-medium text-zinc-900">
              {matchedVendor ?? "— not matched —"}
            </dd>
          </div>
          {(Object.keys(LABELS) as (keyof FieldValues)[]).map((key) => (
            <div key={key}>
              <dt className="text-zinc-500">{LABELS[key]}</dt>
              <dd className="font-medium text-zinc-900">{initial[key] ?? "—"}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {(Object.keys(LABELS) as (keyof FieldValues)[]).map((key) => (
              <label key={key} className="block">
                <span className="text-zinc-500">{LABELS[key]}</span>
                <input
                  type={key.endsWith("Date") ? "date" : "text"}
                  value={values[key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [key]: e.target.value }))
                  }
                  placeholder="—"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:border-zinc-500 focus:outline-none"
                />
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save corrections"}
            </button>
            <button
              onClick={() => {
                setValues(initial);
                setEditing(false);
                setError(null);
              }}
              disabled={pending}
              className="rounded-lg px-4 py-2 text-sm text-zinc-600 ring-1 ring-zinc-300 hover:bg-zinc-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
