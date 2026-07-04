// Human rejection. Unlike approval, a rejection REQUIRES a reason — "why
// was this invoice refused?" is exactly the question an auditor asks.
import { z } from "zod";
import { InvalidTransitionError, transitionInvoice } from "@/lib/invoices";
import { getSession } from "@/lib/session";

const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/invoices/[id]/reject">,
) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = rejectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "a rejection reason (min 3 chars) is required" },
      { status: 400 },
    );
  }

  const { id } = await ctx.params;
  try {
    const updated = await transitionInvoice({
      invoiceId: id,
      to: "REJECTED",
      actor: "HUMAN",
      userId: session.userId,
      action: "REJECTED_BY_HUMAN",
      reason: parsed.data.reason,
    });
    return Response.json({ ok: true, status: updated.status });
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
