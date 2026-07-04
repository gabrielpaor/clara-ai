// Public upload endpoint: accepts an invoice document, persists it, and
// hands off to the n8n extraction workflow.
//
// Data flow: create row (RECEIVED) → store file → fire n8n webhook →
// transition to EXTRACTING (or FAILED if n8n is unreachable). The row is
// created BEFORE the webhook so a crashed handoff still leaves a visible,
// retryable invoice instead of a silently lost file.
import { prisma } from "@/lib/db";
import { transitionInvoice } from "@/lib/invoices";
import { getSession } from "@/lib/session";
import { saveInvoiceFile } from "@/lib/storage";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // Gemini inline data caps at 20MB

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "missing 'file' field in form data" },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return Response.json(
      { error: `unsupported file type '${file.type}' (pdf/png/jpg/webp only)` },
      { status: 415 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "file exceeds 10MB" }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        source: "UPLOAD",
        fileName: file.name,
        mimeType: file.type,
        storagePath: "", // set right after the id exists
      },
    });
    await tx.auditLog.create({
      data: {
        invoiceId: created.id,
        actor: "SYSTEM",
        action: "INVOICE_RECEIVED",
        toStatus: "RECEIVED",
        reason: `Uploaded via API (${file.name}, ${file.size} bytes)`,
      },
    });
    return created;
  });

  const storagePath = await saveInvoiceFile(invoice.id, file.name, bytes);
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { storagePath },
  });

  // Hand off to n8n. Fire-and-record: n8n acknowledges immediately and
  // processes async; the extraction result arrives later via
  // /api/internal/invoices/[id]/extraction.
  let handoffOk = false;
  let handoffDetail: string;
  try {
    const res = await fetch(`${process.env.N8N_WEBHOOK_URL}/invoice-extraction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId: invoice.id }),
    });
    handoffOk = res.ok;
    handoffDetail = `n8n webhook responded ${res.status}`;
  } catch (error) {
    handoffDetail = `n8n unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }

  const updated = await transitionInvoice({
    invoiceId: invoice.id,
    to: handoffOk ? "EXTRACTING" : "FAILED",
    actor: "SYSTEM",
    action: handoffOk ? "EXTRACTION_STARTED" : "HANDOFF_FAILED",
    reason: handoffDetail,
  });

  return Response.json(
    {
      id: updated.id,
      status: updated.status,
      fileName: updated.fileName,
      createdAt: updated.createdAt,
    },
    { status: 201 },
  );
}

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const invoices = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { vendor: { select: { name: true } } },
  });
  return Response.json({ invoices });
}
