// Human approval — the second half of human-in-the-loop. Same audited
// state machine the AI uses, but actor: HUMAN with the reviewer's userId,
// so the audit trail always answers "who approved this?".
import { InvalidTransitionError, transitionInvoice } from "@/lib/invoices";
import { getSession } from "@/lib/session";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/invoices/[id]/approve">,
) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const note = typeof body?.note === "string" ? body.note.slice(0, 500) : undefined;

  try {
    const updated = await transitionInvoice({
      invoiceId: id,
      to: "APPROVED",
      actor: "HUMAN",
      userId: session.userId,
      action: "APPROVED_BY_HUMAN",
      reason: note ?? `Approved by ${session.email}`,
    });
    return Response.json({ ok: true, status: updated.status });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
