import Link from "next/link";
import { notFound } from "next/navigation";
import { ExtractedFields } from "@/components/extracted-fields";
import { ReviewActions } from "@/components/review-actions";
import { RetryButton } from "@/components/retry-button";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

const ACTOR_STYLES: Record<string, string> = {
  AI: "bg-violet-100 text-violet-700",
  HUMAN: "bg-sky-100 text-sky-700",
  SYSTEM: "bg-zinc-100 text-zinc-600",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      vendor: true,
      auditLog: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { email: true } } },
      },
    },
  });
  if (!invoice) notFound();

  // Serialized for the client component: dates as YYYY-MM-DD (editable in
  // <input type="date">), money as fixed-2 strings.
  const fieldValues = {
    vendorName: invoice.vendorNameRaw,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
    dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
    currency: invoice.currency,
    subtotal: invoice.subtotal ? Number(invoice.subtotal.toString()).toFixed(2) : null,
    tax: invoice.tax ? Number(invoice.tax.toString()).toFixed(2) : null,
    total: invoice.total ? Number(invoice.total.toString()).toFixed(2) : null,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/invoices" className="text-sm text-zinc-500 hover:text-zinc-900">
            ← Invoices
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold text-zinc-900">
            {invoice.vendor?.name ?? invoice.vendorNameRaw ?? invoice.fileName}
            <StatusBadge status={invoice.status} />
          </h1>
          <p className="text-sm text-zinc-500">
            {invoice.fileName} · uploaded {formatDateTime(invoice.createdAt)}
          </p>
        </div>
        {invoice.status === "NEEDS_REVIEW" && <ReviewActions invoiceId={invoice.id} />}
        {invoice.status === "FAILED" && <RetryButton invoiceId={invoice.id} />}
      </div>

      {invoice.flags.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-medium">Flags:</span> {invoice.flags.join(", ")}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <ExtractedFields
            invoiceId={invoice.id}
            editable={invoice.status === "NEEDS_REVIEW"}
            initial={fieldValues}
            matchedVendor={invoice.vendor?.name ?? null}
            confidence={invoice.confidence}
          />

          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="mb-4 font-medium text-zinc-900">Audit trail</h2>
            <ol className="space-y-4">
              {invoice.auditLog.map((entry) => (
                <li key={entry.id} className="flex gap-3 text-sm">
                  <span
                    className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ACTOR_STYLES[entry.actor]}`}
                  >
                    {entry.actor}
                  </span>
                  <div>
                    <p className="font-medium text-zinc-900">
                      {entry.action.replaceAll("_", " ")}
                      {entry.fromStatus && entry.toStatus && (
                        <span className="ml-2 font-normal text-zinc-500">
                          {entry.fromStatus} → {entry.toStatus}
                        </span>
                      )}
                    </p>
                    {entry.reason && <p className="text-zinc-600">{entry.reason}</p>}
                    <p className="text-xs text-zinc-400">
                      {formatDateTime(entry.createdAt)}
                      {entry.user && ` · ${entry.user.email}`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section className="rounded-xl border border-zinc-200 bg-white p-3 lg:col-span-3 lg:sticky lg:top-6 lg:self-start">
          <div className="flex items-center justify-between px-1 pb-3">
            <h2 className="font-medium text-zinc-900">Document</h2>
            <a
              href={`/api/invoices/${invoice.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-500 hover:text-zinc-900 hover:underline"
            >
              Open in new tab ↗
            </a>
          </div>
          <div className="overflow-hidden rounded-lg bg-zinc-100">
            <iframe
              src={`/api/invoices/${invoice.id}/file`}
              title="Invoice document"
              className="h-[70vh] min-h-[560px] w-full bg-white lg:h-[calc(100vh-11rem)]"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
