// Batch upload: multiple files and/or ZIP archives in one request.
// Every contained document becomes a normal invoice (shared intake path)
// tagged with a batchId — but NOT dispatched: batch items are created as
// RECEIVED and drip-fed to extraction by the batch-dispatcher workflow,
// so month-end ZIP dumps can't stampede the LLM rate limit.
//
// ZIPs are hostile input and are treated as such: entry-count cap,
// per-entry and total size caps checked against the zip's own headers
// BEFORE inflating (zip-bomb guard), extension allowlist, and only the
// basename of entry paths is ever used (zip-slip guard — also enforced
// again inside storage.ts).
import AdmZip from "adm-zip";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  ALLOWED_MIME_TYPES,
  createAndDispatchInvoice,
  MAX_FILE_BYTES,
} from "@/lib/dispatch";
import { getSession } from "@/lib/session";

const MAX_DOCS_PER_BATCH = 20;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_EXPANDED_BYTES = 100 * 1024 * 1024;

const EXTENSION_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

interface BatchDoc {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  origin: string; // provenance detail for the audit log
}

function isZip(file: File): boolean {
  return (
    file.type.includes("zip") || file.name.toLowerCase().endsWith(".zip")
  );
}

function expandZip(zipName: string, data: Buffer): BatchDoc[] | { error: string } {
  const zip = new AdmZip(data);
  const docs: BatchDoc[] = [];
  let totalExpanded = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const baseName = path.basename(entry.entryName);
    // macOS zips ship metadata sidecars; dotfiles are never invoices
    if (entry.entryName.includes("__MACOSX") || baseName.startsWith(".")) {
      continue;
    }
    const ext = path.extname(baseName).toLowerCase();
    const mimeType = EXTENSION_MIME[ext];
    if (!mimeType) continue; // silently skip non-document entries

    // Size checks use the zip's declared uncompressed size BEFORE
    // inflating — inflate-then-check is how zip bombs win.
    const declaredSize = entry.header.size;
    if (declaredSize > MAX_FILE_BYTES) {
      return { error: `${baseName} in ${zipName} exceeds 10MB` };
    }
    totalExpanded += declaredSize;
    if (totalExpanded > MAX_TOTAL_EXPANDED_BYTES) {
      return { error: `${zipName} expands beyond the total size limit` };
    }

    docs.push({
      fileName: baseName,
      mimeType,
      bytes: entry.getData(),
      origin: `from ${zipName}`,
    });
  }
  return docs;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json(
      { error: "missing 'files' field(s) in form data" },
      { status: 400 },
    );
  }

  // Expand everything first — validate the whole batch before creating anything.
  const docs: BatchDoc[] = [];
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (isZip(file)) {
      if (bytes.length > MAX_ZIP_BYTES) {
        return Response.json({ error: `${file.name} exceeds 25MB` }, { status: 413 });
      }
      const expanded = expandZip(file.name, bytes);
      if ("error" in expanded) {
        return Response.json({ error: expanded.error }, { status: 422 });
      }
      docs.push(...expanded);
    } else {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return Response.json(
          { error: `unsupported file type '${file.type}' for ${file.name}` },
          { status: 415 },
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return Response.json({ error: `${file.name} exceeds 10MB` }, { status: 413 });
      }
      docs.push({
        fileName: file.name,
        mimeType: file.type,
        bytes,
        origin: "direct file",
      });
    }
  }

  if (docs.length === 0) {
    return Response.json(
      { error: "no processable documents found (pdf/png/jpg/webp)" },
      { status: 422 },
    );
  }
  if (docs.length > MAX_DOCS_PER_BATCH) {
    return Response.json(
      { error: `batch contains ${docs.length} documents; limit is ${MAX_DOCS_PER_BATCH}` },
      { status: 413 },
    );
  }

  const batch = await prisma.batch.create({
    data: {
      label:
        files.length === 1 && isZip(files[0])
          ? files[0].name
          : `${docs.length} files`,
      createdById: session.userId,
    },
  });

  const invoices = [];
  for (const doc of docs) {
    const invoice = await createAndDispatchInvoice({
      source: "UPLOAD",
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      bytes: doc.bytes,
      batchId: batch.id,
      deferDispatch: true, // the batch-dispatcher workflow feeds these out
      receivedVia: `Batch ${batch.id} uploaded by ${session.email} (${doc.origin}, ${doc.bytes.length} bytes)`,
    });
    invoices.push({ id: invoice.id, fileName: invoice.fileName });
  }

  return Response.json(
    { batchId: batch.id, invoiceCount: invoices.length, invoices },
    { status: 201 },
  );
}
