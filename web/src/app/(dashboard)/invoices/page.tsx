import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/db";
import { InvoiceStatus } from "@/generated/prisma/client";
import { formatDateTime, formatMoney } from "@/lib/format";

const STATUSES = Object.values(InvoiceStatus);

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; batch?: string }>;
}) {
  const { status, batch } = await searchParams;
  const filter =
    status && STATUSES.includes(status as InvoiceStatus)
      ? (status as InvoiceStatus)
      : undefined;

  const [invoices, batchInfo] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        ...(filter ? { status: filter } : {}),
        ...(batch ? { batchId: batch } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { vendor: { select: { name: true } } },
    }),
    batch
      ? prisma.batch.findUnique({
          where: { id: batch },
          select: { label: true, createdAt: true },
        })
      : null,
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">Invoices</h1>

      {batch && (
        <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm">
          <span className="text-zinc-600">
            Batch: <span className="font-medium text-zinc-900">{batchInfo?.label ?? batch}</span>
            {" · "}
            {invoices.length} invoice(s)
            {" · "}
            {invoices.filter((i) => i.status === "RECEIVED").length} waiting
            {" · "}
            {invoices.filter((i) => i.status === "EXTRACTING").length} processing
          </span>
          <Link href="/invoices" className="ml-auto text-zinc-500 hover:text-zinc-900">
            Clear ✕
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <FilterTab href="/invoices" label="All" active={!filter} />
        {STATUSES.map((s) => (
          <FilterTab
            key={s}
            href={`/invoices?status=${s}`}
            label={s.replace("_", " ")}
            active={filter === s}
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">Invoice #</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Confidence</th>
              <th className="px-4 py-3 font-medium">Flags</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <Link href={`/invoices/${inv.id}`} className="font-medium text-zinc-900 hover:underline">
                    {inv.vendor?.name ?? inv.vendorNameRaw ?? inv.fileName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600">{inv.invoiceNumber ?? "—"}</td>
                <td className="px-4 py-3 font-medium text-zinc-900">
                  {formatMoney(inv.total?.toString() ?? null, inv.currency)}
                </td>
                <td className="px-4 py-3 text-zinc-600">
                  {inv.confidence !== null ? `${Math.round(inv.confidence * 100)}%` : "—"}
                </td>
                <td className="px-4 py-3">
                  {inv.flags.length > 0 ? (
                    <span className="text-xs text-red-600">{inv.flags.join(", ")}</span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                <td className="px-4 py-3 text-zinc-500">{formatDateTime(inv.createdAt)}</td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No invoices{filter ? ` with status ${filter}` : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-sm ${
        active
          ? "bg-zinc-900 text-white"
          : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100"
      }`}
    >
      {label}
    </Link>
  );
}
