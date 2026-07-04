// Human-triggered retry for FAILED invoices. The state machine has allowed
// FAILED → EXTRACTING since Phase 1 — this endpoint is why. The original
// file is still in storage, so a retry is just: transition (audited, with
// the requesting user) and re-fire the extraction webhook.
import { fireExtractionWebhook } from "@/lib/dispatch";
import { InvalidTransitionError, transitionInvoice } from "@/lib/invoices";
import { getSession } from "@/lib/session";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/invoices/[id]/retry">,
) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  try {
    await transitionInvoice({
      invoiceId: id,
      to: "EXTRACTING",
      actor: "HUMAN",
      userId: session.userId,
      action: "RETRY_REQUESTED",
      reason: `Retry requested by ${session.email}`,
    });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  const handoff = await fireExtractionWebhook(id);
  if (!handoff.ok) {
    // Webhook refused: roll the invoice back to FAILED so it stays retryable
    // instead of hanging in EXTRACTING with no workflow running.
    await transitionInvoice({
      invoiceId: id,
      to: "FAILED",
      actor: "SYSTEM",
      action: "HANDOFF_FAILED",
      reason: handoff.detail,
    });
    return Response.json({ error: handoff.detail }, { status: 502 });
  }

  return Response.json({ ok: true, status: "EXTRACTING" });
}
