import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { UploadInvoice } from "@/components/upload-invoice";
import { prisma } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";

export default async function DashboardPage() {
  const [byStatus, approvedSum, recent] = await Promise.all([
    prisma.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.invoice.aggregate({
      _sum: { total: true },
      where: { status: { in: ["APPROVED", "SCHEDULED", "PAID"] } },
    }),
    prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { vendor: { select: { name: true } } },
    }),
  ]);

  const count = (status: string) =>
    byStatus.find((s) => s.status === status)?._count._all ?? 0;

  const stats = [
    { label: "Needs review", value: count("NEEDS_REVIEW"), accent: "text-amber-600" },
    { label: "Approved", value: count("APPROVED") + count("SCHEDULED") + count("PAID"), accent: "text-green-600" },
    {
      label: "Approved amount",
      value: formatMoney(approvedSum._sum.total?.toString() ?? null, "USD"),
      accent: "text-zinc-900",
    },
    { label: "Failed", value: count("FAILED"), accent: "text-red-600" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Dashboard</h1>
          <p className="text-sm text-zinc-500">
            Clara processes every invoice; you decide the edge cases.
          </p>
        </div>
        <UploadInvoice />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-zinc-200 bg-white p-4"
          >
            <p className="text-sm text-zinc-500">{stat.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${stat.accent}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium text-zinc-900">Recent invoices</h2>
          <Link href="/invoices" className="text-sm text-zinc-500 hover:text-zinc-900">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Received</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((inv) => (
                <tr key={inv.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${inv.id}`} className="font-medium text-zinc-900 hover:underline">
                      {inv.vendor?.name ?? inv.vendorNameRaw ?? inv.fileName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{inv.invoiceNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-900">
                    {formatMoney(inv.total?.toString() ?? null, inv.currency)}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-3 text-zinc-500">{formatDateTime(inv.createdAt)}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No invoices yet — upload one to see Clara work.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
