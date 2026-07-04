import type { InvoiceStatus } from "@/generated/prisma/client";

const STYLES: Record<InvoiceStatus, string> = {
  RECEIVED: "bg-zinc-100 text-zinc-700",
  EXTRACTING: "bg-blue-100 text-blue-700",
  NEEDS_REVIEW: "bg-amber-100 text-amber-800",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  SCHEDULED: "bg-indigo-100 text-indigo-700",
  PAID: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
