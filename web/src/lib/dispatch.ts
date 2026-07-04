// Shared intake logic: every invoice — uploaded, emailed, or any future
// source — enters the system through this one function, so the row-first
// guarantee, file storage, webhook handoff, and audit trail can never
// drift apart between entry points.
import { prisma } from "@/lib/db";
import { transitionInvoice } from "@/lib/invoices";
import { saveInvoiceFile } from "@/lib/storage";
import type { InvoiceSource } from "@/generated/prisma/client";

export interface IntakeInput {
  source: InvoiceSource;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  /** External origin id (e.g. Gmail message id) for ingest dedup */
  sourceRef?: string;
  /** Human-readable provenance for the audit log */
  receivedVia: string;
}

export async function createAndDispatchInvoice(input: IntakeInput) {
  // Row first, file second, handoff last: a crash at any step leaves a
  // visible, explainable record instead of an orphaned file or lost invoice.
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        source: input.source,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sourceRef: input.sourceRef,
        storagePath: "",
      },
    });
    await tx.auditLog.create({
      data: {
        invoiceId: created.id,
        actor: "SYSTEM",
        action: "INVOICE_RECEIVED",
        toStatus: "RECEIVED",
        reason: input.receivedVia,
      },
    });
    return created;
  });

  const storagePath = await saveInvoiceFile(
    invoice.id,
    input.fileName,
    input.bytes,
  );
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { storagePath },
  });

  const handoff = await fireExtractionWebhook(invoice.id);

  return transitionInvoice({
    invoiceId: invoice.id,
    to: handoff.ok ? "EXTRACTING" : "FAILED",
    actor: "SYSTEM",
    action: handoff.ok ? "EXTRACTION_STARTED" : "HANDOFF_FAILED",
    reason: handoff.detail,
  });
}

/** Fires the n8n extraction webhook. Shared by first intake and retries. */
export async function fireExtractionWebhook(
  invoiceId: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(
      `${process.env.N8N_WEBHOOK_URL}/invoice-extraction`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      },
    );
    return { ok: res.ok, detail: `n8n webhook responded ${res.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: `n8n unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
