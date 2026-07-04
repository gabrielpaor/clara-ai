import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewActions } from "@/components/review-actions";
import { RetryButton } from "@/components/retry-button";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

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

  const fields = [
    { label: "Vendor (matched)", value: invoice.vendor?.name ?? "— not matched —" },
    { label: "Vendor (as printed)", value: invoice.vendorNameRaw ?? "—" },
    { label: "Invoice #", value: invoice.invoiceNumber ?? "—" },
    { label: "Invoice date", value: formatDate(invoice.invoiceDate) },
    { label: "Due date", value: formatDate(invoice.dueDate) },
    { label: "Subtotal", value: formatMoney(invoice.subtotal?.toString() ?? null, invoice.currency) },
    { label: "Tax", value: formatMoney(invoice.tax?.toString() ?? null, invoice.currency) },
    { label: "Total", value: formatMoney(invoice.total?.toString() ?? null, invoice.currency) },
  ];

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

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium text-zinc-900">Extracted data</h2>
              {invoice.confidence !== null && (
                <span className="text-sm text-zinc-500">
                  Confidence: {Math.round(invoice.confidence * 100)}%
                </span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {fields.map((f) => (
                <div key={f.label}>
                  <dt className="text-zinc-500">{f.label}</dt>
                  <dd className="font-medium text-zinc-900">{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>

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

        <section className="rounded-xl border border-zinc-200 bg-white p-2">
          <iframe
            src={`/api/invoices/${invoice.id}/file`}
            title="Invoice document"
            className="h-[720px] w-full rounded-lg"
          />
        </section>
      </div>
    </div>
  );
}
