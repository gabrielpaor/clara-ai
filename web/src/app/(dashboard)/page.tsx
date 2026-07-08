import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { UploadInvoice } from "@/components/upload-invoice";
import { prisma } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";

const HEALTH_WINDOW_DAYS = 7;

// Outside the component: the React Compiler (correctly) refuses impure
// calls like Date.now() in a component body.
function healthWindowStart(): Date {
  return new Date(Date.now() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export default async function DashboardPage() {
  const healthSince = healthWindowStart();
  const [byStatus, approvedSum, recent, runsByStatus, recentFailures, costAgg] =
    await Promise.all([
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
      prisma.workflowRun.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { startedAt: { gte: healthSince } },
      }),
      prisma.workflowRun.findMany({
        where: { status: "FAILED", startedAt: { gte: healthSince } },
        orderBy: { startedAt: "desc" },
        take: 5,
      }),
      prisma.workflowRun.aggregate({
        where: {
          workflowName: "invoice-extraction",
          startedAt: { gte: healthSince },
          costUsd: { not: null },
        },
        _sum: { costUsd: true, promptTokens: true, outputTokens: true },
        _count: { costUsd: true },
      }),
    ]);

  const runCount = (status: string) =>
    runsByStatus.find((r) => r.status === status)?._count._all ?? 0;
  const totalRuns = runCount("SUCCESS") + runCount("FAILED");
  const successRate =
    totalRuns === 0 ? null : Math.round((runCount("SUCCESS") / totalRuns) * 100);

  const costedRuns = costAgg._count.costUsd;
  const totalCost = costAgg._sum.costUsd ? Number(costAgg._sum.costUsd.toString()) : 0;
  const totalTokens =
    (costAgg._sum.promptTokens ?? 0) + (costAgg._sum.outputTokens ?? 0);

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
          <h2 className="font-medium text-zinc-900">Automation health</h2>
          <span className="text-sm text-zinc-500">last {HEALTH_WINDOW_DAYS} days</span>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-500">LLM cost (est.)</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900">
              {costedRuns === 0 ? "—" : `$${totalCost.toFixed(4)}`}
            </p>
            <p className="text-xs text-zinc-400">
              {costedRuns === 0
                ? "no priced runs yet"
                : `${costedRuns} extraction(s) · ${(totalTokens / 1000).toFixed(1)}k tokens · ~$${(totalCost / costedRuns).toFixed(4)}/invoice at paid-tier rates`}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-500">Extraction success rate</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                successRate === null
                  ? "text-zinc-400"
                  : successRate >= 90
                    ? "text-green-600"
                    : "text-amber-600"
              }`}
            >
              {successRate === null ? "—" : `${successRate}%`}
            </p>
            <p className="text-xs text-zinc-400">
              {runCount("SUCCESS")} ok · {runCount("FAILED")} failed
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 md:col-span-2">
            <p className="mb-2 text-sm text-zinc-500">Recent workflow failures</p>
            {recentFailures.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No failures in the last {HEALTH_WINDOW_DAYS} days.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {recentFailures.map((run) => (
                  <li key={run.id} className="text-sm">
                    <span className="font-medium text-zinc-900">
                      {run.workflowName}
                    </span>
                    <span className="text-zinc-400"> · {formatDateTime(run.startedAt)} · </span>
                    <span className="text-red-600">
                      {(run.error ?? "unknown error").slice(0, 90)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

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
