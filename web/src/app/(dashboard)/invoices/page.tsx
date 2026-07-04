import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/db";
import { InvoiceStatus } from "@/generated/prisma/client";
import { formatDateTime, formatMoney } from "@/lib/format";

const STATUSES = Object.values(InvoiceStatus);

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter =
    status && STATUSES.includes(status as InvoiceStatus)
      ? (status as InvoiceStatus)
      : undefined;

  const invoices = await prisma.invoice.findMany({
    where: filter ? { status: filter } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { vendor: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-900">Invoices</h1>

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
                <td className="px-4 py-3">{formatMoney(inv.total?.toString() ?? null, inv.currency)}</td>
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
