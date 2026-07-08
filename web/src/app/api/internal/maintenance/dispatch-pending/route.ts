// Called by the batch-dispatcher workflow every minute. Feeds RECEIVED
// invoices to extraction a few at a time — a poor-man's queue that keeps
// batch uploads inside the LLM's rate limit. (The real-queue upgrade —
// backpressure, priorities, DLQ — is a documented v2.0 item.)
//
// The age guard exists because single uploads also pass through RECEIVED
// for a moment before their own inline dispatch; only invoices that have
// *sat* in RECEIVED belong to us. And if we ever do race the inline
// dispatch, the atomic transition guard means exactly one caller wins —
// the loser's InvalidTransitionError is simply skipped.
import { prisma } from "@/lib/db";
import { handoffToExtraction } from "@/lib/dispatch";
import { InvalidTransitionError } from "@/lib/invoices";
import { isInternalRequest, unauthorized } from "@/lib/internal-auth";

const MIN_AGE_SECONDS = 60;

export async function POST(request: Request) {
  if (!isInternalRequest(request)) return unauthorized();

  const perTick = Number(process.env.BATCH_DISPATCH_PER_TICK ?? 4);
  const cutoff = new Date(Date.now() - MIN_AGE_SECONDS * 1000);

  const pending = await prisma.invoice.findMany({
    where: { status: "RECEIVED", createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" }, // oldest first — fair queue order
    take: perTick,
    select: { id: true },
  });

  let dispatched = 0;
  for (const { id } of pending) {
    try {
      await handoffToExtraction(id);
      dispatched++;
    } catch (error) {
      if (error instanceof InvalidTransitionError) continue; // lost a race — fine
      throw error;
    }
  }

  return Response.json({ ok: true, dispatched, pendingSeen: pending.length });
}
