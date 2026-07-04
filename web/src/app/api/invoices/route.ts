// Public upload endpoint (dashboard users). Intake itself — row creation,
// storage, n8n handoff — lives in lib/dispatch.ts, shared with email ingest.
import { prisma } from "@/lib/db";
import {
  ALLOWED_MIME_TYPES,
  createAndDispatchInvoice,
  MAX_FILE_BYTES,
} from "@/lib/dispatch";
import { getSession } from "@/lib/session";

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

  const invoice = await createAndDispatchInvoice({
    source: "UPLOAD",
    fileName: file.name,
    mimeType: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
    receivedVia: `Uploaded via dashboard by ${session.email} (${file.name}, ${file.size} bytes)`,
  });

  return Response.json(
    {
      id: invoice.id,
      status: invoice.status,
      fileName: invoice.fileName,
      createdAt: invoice.createdAt,
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
