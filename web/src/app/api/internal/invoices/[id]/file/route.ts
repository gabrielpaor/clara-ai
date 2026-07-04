// Internal: n8n downloads the original document here as base64 JSON —
// which the workflow forwards straight into Gemini's inline_data field.
import { prisma } from "@/lib/db";
import { isInternalRequest, unauthorized } from "@/lib/internal-auth";
import { readInvoiceFile } from "@/lib/storage";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/internal/invoices/[id]/file">,
) {
  if (!isInternalRequest(request)) return unauthorized();

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { fileName: true, mimeType: true, storagePath: true },
  });
  if (!invoice || !invoice.storagePath) {
    return Response.json({ error: "invoice or file not found" }, { status: 404 });
  }

  const data = await readInvoiceFile(invoice.storagePath);
  return Response.json({
    fileName: invoice.fileName,
    mimeType: invoice.mimeType,
    data: data.toString("base64"),
  });
}
