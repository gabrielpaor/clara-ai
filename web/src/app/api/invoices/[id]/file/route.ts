// Serves the original document to logged-in reviewers (inline PDF preview
// on the invoice detail page). The n8n variant of this endpoint lives under
// /api/internal and uses the service key instead of a session.
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { readInvoiceFile } from "@/lib/storage";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/invoices/[id]/file">,
) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { fileName: true, mimeType: true, storagePath: true },
  });
  if (!invoice || !invoice.storagePath) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const data = await readInvoiceFile(invoice.storagePath);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": invoice.mimeType,
      "content-disposition": `inline; filename="${invoice.fileName.replace(/"/g, "")}"`,
    },
  });
}
