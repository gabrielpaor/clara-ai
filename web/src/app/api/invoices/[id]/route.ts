// PATCH: manual field corrections by a reviewer. Thin wrapper — parse,
// authenticate, delegate to the corrections service, map errors to HTTP.
import { applyCorrections, CorrectionNotAllowedError } from "@/lib/corrections";
import { getSession } from "@/lib/session";
import { extractedFieldsSchema } from "@/lib/validation/extraction";

const correctionSchema = extractedFieldsSchema.partial();

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/invoices/[id]">,
) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const parsed = correctionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "invalid corrections", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { id } = await ctx.params;
  try {
    const result = await applyCorrections({
      invoiceId: id,
      userId: session.userId,
      userEmail: session.email,
      input: parsed.data,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CorrectionNotAllowedError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "P2025"
    ) {
      return Response.json({ error: "invoice not found" }, { status: 404 });
    }
    throw error;
  }
}
