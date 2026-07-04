// Internal: n8n reports the extraction outcome here. This endpoint is
// where "AI output" becomes "business data": Zod validation, vendor
// matching, sanity flags, duplicate checks (exact + embedding-based),
// then the auto-approval decision — all audited. n8n stays a dumb pipe;
// business logic lives in the app.
import { prisma } from "@/lib/db";
import { transitionInvoice } from "@/lib/invoices";
import { isInternalRequest, unauthorized } from "@/lib/internal-auth";
import { notifyInvoiceOutcome } from "@/lib/notify";
import { evaluateInvoice } from "@/lib/rules";
import {
  extractionReportSchema,
  type ExtractedFields,
} from "@/lib/validation/extraction";

/** Cosine similarity above which two invoices are considered near-duplicates. */
const NEAR_DUPLICATE_THRESHOLD = 0.95;

/** "1234.5" float → "1234.50" string, the safe input form for Decimal columns. */
function toDecimalString(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function toUtcDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00Z`);
}

async function computeFlagsAndVendor(invoiceId: string, data: ExtractedFields) {
  const flags: string[] = [];

  const vendor = data.vendorName
    ? await prisma.vendor.findFirst({
        where: { name: { equals: data.vendorName, mode: "insensitive" } },
      })
    : null;
  if (!vendor) flags.push("UNKNOWN_VENDOR");

  if (data.subtotal !== null && data.tax !== null && data.total !== null) {
    if (Math.abs(data.subtotal + data.tax - data.total) > 0.01) {
      flags.push("TOTALS_MISMATCH");
    }
  }

  // Exact duplicate: the DB constraint on (vendorId, invoiceNumber) is the
  // hard guard; we pre-check so a duplicate becomes a reviewable flag
  // instead of a 500.
  let duplicateOf: string | null = null;
  if (vendor && data.invoiceNumber) {
    const existing = await prisma.invoice.findFirst({
      where: {
        vendorId: vendor.id,
        invoiceNumber: data.invoiceNumber,
        id: { not: invoiceId },
      },
      select: { id: true },
    });
    if (existing) {
      flags.push("DUPLICATE_SUSPECTED");
      duplicateOf = existing.id;
    }
  }

  return { flags, vendor, duplicateOf };
}

/**
 * Near-duplicate detection, layer two: cosine similarity against every
 * previously embedded invoice. Catches what the exact-match constraint
 * misses — the same invoice rescanned with small OCR differences
 * ("INV-42" vs "INV-0042", "Acme Inc." vs "ACME Inc").
 */
async function findNearDuplicate(invoiceId: string, embedding: number[]) {
  const vector = `[${embedding.join(",")}]`;
  const rows = await prisma.$queryRaw<{ id: string; similarity: number }[]>`
    SELECT id, 1 - (embedding <=> ${vector}::vector) AS similarity
    FROM "Invoice"
    WHERE embedding IS NOT NULL AND id <> ${invoiceId}
    ORDER BY embedding <=> ${vector}::vector
    LIMIT 1`;
  const nearest = rows[0];
  return nearest && nearest.similarity >= NEAR_DUPLICATE_THRESHOLD
    ? nearest
    : null;
}

async function storeEmbedding(invoiceId: string, embedding: number[]) {
  const vector = `[${embedding.join(",")}]`;
  await prisma.$executeRaw`
    UPDATE "Invoice" SET embedding = ${vector}::vector WHERE id = ${invoiceId}`;
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/internal/invoices/[id]/extraction">,
) {
  if (!isInternalRequest(request)) return unauthorized();

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return Response.json({ error: "invoice not found" }, { status: 404 });
  }
  // Idempotency guard: only an invoice mid-extraction may receive a result.
  // A duplicate/late n8n callback gets a 409 instead of double-applying.
  if (invoice.status !== "EXTRACTING") {
    return Response.json(
      { error: `invoice is ${invoice.status}, expected EXTRACTING` },
      { status: 409 },
    );
  }

  const parsed = extractionReportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const report = parsed.data;

  if (report.outcome === "failure") {
    await transitionInvoice({
      invoiceId: id,
      to: "FAILED",
      actor: "SYSTEM",
      action: "EXTRACTION_FAILED",
      reason: report.error.slice(0, 1000),
    });
    notifyInvoiceOutcome({
      invoiceId: id,
      status: "FAILED",
      vendorName: invoice.vendorNameRaw,
      fileName: invoice.fileName,
      total: null,
      currency: null,
      reason: report.error.slice(0, 300),
    });
    return Response.json({ ok: true, status: "FAILED" });
  }

  const { data, confidence, warnings } = report;
  const embedding = report.embedding ?? null;
  const { flags, vendor, duplicateOf } = await computeFlagsAndVendor(id, data);

  // Embedding-based near-duplicate check runs BEFORE we store our own
  // embedding, so an invoice can never match itself.
  let nearDuplicate: { id: string; similarity: number } | null = null;
  if (embedding) {
    nearDuplicate = await findNearDuplicate(id, embedding);
    if (nearDuplicate && !flags.includes("DUPLICATE_SUSPECTED")) {
      flags.push("NEAR_DUPLICATE");
    }
  } else {
    // No embedding means degraded duplicate protection — a human should look.
    flags.push("EMBEDDING_UNAVAILABLE");
  }

  await prisma.invoice.update({
    where: { id },
    data: {
      // A suspected duplicate keeps vendorId null so the unique constraint
      // (vendorId, invoiceNumber) is not violated; the flag + audit metadata
      // carry the evidence for the human reviewer.
      vendorId: duplicateOf ? null : (vendor?.id ?? null),
      vendorNameRaw: data.vendorName,
      invoiceNumber: data.invoiceNumber,
      invoiceDate: toUtcDate(data.invoiceDate),
      dueDate: toUtcDate(data.dueDate),
      currency: data.currency,
      subtotal: toDecimalString(data.subtotal),
      tax: toDecimalString(data.tax),
      total: toDecimalString(data.total),
      extraction: { data, confidence, warnings },
      confidence,
      flags,
    },
  });
  if (embedding) await storeEmbedding(id, embedding);

  // The decision: auto-approve or route to a human, with stated reasons.
  const decision = evaluateInvoice({
    data,
    confidence,
    vendorMatched: vendor !== null && !duplicateOf,
    flags,
  });

  const updated = await transitionInvoice({
    invoiceId: id,
    to: decision.approve ? "APPROVED" : "NEEDS_REVIEW",
    actor: "AI",
    action: decision.approve ? "AUTO_APPROVED" : "ROUTED_TO_REVIEW",
    reason: decision.approve
      ? `All checks passed (confidence ${confidence.toFixed(2)})`
      : decision.reasons.join("; "),
    metadata: {
      confidence,
      warnings,
      flags,
      duplicateOf,
      nearDuplicate,
      checks: decision.checks,
    },
  });

  if (!decision.approve) {
    notifyInvoiceOutcome({
      invoiceId: id,
      status: "NEEDS_REVIEW",
      vendorName: data.vendorName,
      fileName: invoice.fileName,
      total: data.total === null ? null : data.total.toFixed(2),
      currency: data.currency,
      reason: decision.reasons.join("; "),
    });
  }

  return Response.json({ ok: true, status: updated.status, flags });
}
