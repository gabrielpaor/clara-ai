// Called by the scheduled maintenance workflow. Finds invoices that have
// been EXTRACTING for too long — the workflow died without ever calling
// back (n8n restart mid-run, network partition) — and fails them so they
// become visible and retryable. Reliability rule: every async job needs a
// timeout owner, because "the callback will come" is not a guarantee.
import { prisma } from "@/lib/db";
import { transitionInvoice } from "@/lib/invoices";
import { isInternalRequest, unauthorized } from "@/lib/internal-auth";
import { notifySystemAlert } from "@/lib/notify";

const STUCK_AFTER_MINUTES = 10;

export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized();

  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000);
  const stuck = await prisma.invoice.findMany({
    where: { status: "EXTRACTING", updatedAt: { lt: cutoff } },
    select: { id: true, fileName: true },
  });

  for (const invoice of stuck) {
    await transitionInvoice({
      invoiceId: invoice.id,
      to: "FAILED",
      actor: "SYSTEM",
      action: "EXTRACTION_TIMED_OUT",
      reason: `No extraction callback within ${STUCK_AFTER_MINUTES} minutes — workflow presumed dead. Retry available.`,
    });
  }

  if (stuck.length > 0) {
    notifySystemAlert(
      `${stuck.length} stuck invoice(s) requeued`,
      `<p>${stuck.length} invoice(s) sat in EXTRACTING for over ${STUCK_AFTER_MINUTES} minutes and were marked FAILED (retryable):</p>` +
        `<ul>${stuck.map((s) => `<li>${s.fileName} (${s.id})</li>`).join("")}</ul>`,
    );
  }

  return Response.json({ ok: true, requeued: stuck.length });
}
