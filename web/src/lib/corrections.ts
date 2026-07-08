// Manual correction service: a reviewer fixes extracted fields before
// approving, instead of rejecting an invoice over a typo.
//
// Rules:
//  - Only NEEDS_REVIEW invoices are correctable (that's the workbench).
//  - Every change is audited as FIELD_CORRECTED with old → new values —
//    corrections are never silent updates.
//  - Enrichment re-runs afterwards: fixing the vendor name clears
//    UNKNOWN_VENDOR by itself; changing an invoice number to one that
//    already exists raises DUPLICATE_SUSPECTED. Same rules as extraction,
//    same module (lib/enrichment.ts).
//  - Embedding-based flags (NEAR_DUPLICATE, EMBEDDING_UNAVAILABLE) are
//    preserved as-is: recomputing them would need a new LLM call, and a
//    human is already looking at this invoice.
import { prisma } from "@/lib/db";
import { computeFlagsAndVendor } from "@/lib/enrichment";
import type { ExtractedFields } from "@/lib/validation/extraction";

/** Flags carried over from extraction rather than recomputed here. */
const PRESERVED_FLAGS = new Set(["NEAR_DUPLICATE", "EMBEDDING_UNAVAILABLE"]);

export const HUMAN_CORRECTED_FLAG = "HUMAN_CORRECTED";

export type CorrectionInput = Partial<ExtractedFields>;

export class CorrectionNotAllowedError extends Error {
  constructor(status: string) {
    super(`corrections are only allowed in NEEDS_REVIEW (invoice is ${status})`);
    this.name = "CorrectionNotAllowedError";
  }
}

function dateToIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

function moneyToString(value: { toString(): string } | null): string | null {
  return value === null ? null : Number(value.toString()).toFixed(2);
}

export async function applyCorrections(params: {
  invoiceId: string;
  userId: string;
  userEmail: string;
  input: CorrectionInput;
}) {
  const { invoiceId, userId, userEmail, input } = params;

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
  });
  if (invoice.status !== "NEEDS_REVIEW") {
    throw new CorrectionNotAllowedError(invoice.status);
  }

  // Current values, normalized to the same representation as the input
  // (ISO date strings, fixed-2 money strings) so diffing is honest.
  const current: ExtractedFields = {
    vendorName: invoice.vendorNameRaw,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: dateToIso(invoice.invoiceDate),
    dueDate: dateToIso(invoice.dueDate),
    currency: invoice.currency,
    subtotal: invoice.subtotal === null ? null : Number(invoice.subtotal.toString()),
    tax: invoice.tax === null ? null : Number(invoice.tax.toString()),
    total: invoice.total === null ? null : Number(invoice.total.toString()),
  };

  // Diff: only fields present in the input AND actually different count.
  type FieldValue = string | number | null;
  const changes: Record<string, { from: FieldValue; to: FieldValue }> = {};
  const corrected: ExtractedFields = { ...current };
  for (const key of Object.keys(input) as (keyof ExtractedFields)[]) {
    const to = input[key];
    if (to === undefined) continue;
    const from = current[key];
    const normalizedFrom =
      typeof from === "number" ? from.toFixed(2) : (from ?? null);
    const normalizedTo = typeof to === "number" ? to.toFixed(2) : (to ?? null);
    if (normalizedFrom === normalizedTo) continue;
    changes[key] = { from, to: to ?? null };
    // TS can't relate key/value types through the loop; values are
    // schema-validated upstream.
    (corrected as Record<string, unknown>)[key] = to ?? null;
  }

  if (Object.keys(changes).length === 0) {
    return { changed: false as const, changes: {}, flags: invoice.flags };
  }

  // Re-run deterministic enrichment on the corrected data, preserving
  // the embedding-derived flags and marking the human's involvement.
  const { flags, vendor, duplicateOf } = await computeFlagsAndVendor(
    invoiceId,
    corrected,
  );
  const preserved = invoice.flags.filter((f) => PRESERVED_FLAGS.has(f));
  const newFlags = [...new Set([...flags, ...preserved, HUMAN_CORRECTED_FLAG])];

  const summary = Object.entries(changes)
    .map(([field, c]) => `${field}: ${c.from ?? "—"} → ${c.to ?? "—"}`)
    .join("; ");

  const [updated] = await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        vendorNameRaw: corrected.vendorName,
        invoiceNumber: corrected.invoiceNumber,
        invoiceDate: corrected.invoiceDate
          ? new Date(`${corrected.invoiceDate}T00:00:00Z`)
          : null,
        dueDate: corrected.dueDate
          ? new Date(`${corrected.dueDate}T00:00:00Z`)
          : null,
        currency: corrected.currency,
        subtotal: corrected.subtotal === null ? null : corrected.subtotal.toFixed(2),
        tax: corrected.tax === null ? null : corrected.tax.toFixed(2),
        total: corrected.total === null ? null : corrected.total.toFixed(2),
        // Same duplicate rule as extraction: a suspected duplicate keeps
        // vendorId null so the unique constraint can't be violated.
        vendorId: duplicateOf ? null : (vendor?.id ?? null),
        flags: newFlags,
      },
    }),
    prisma.auditLog.create({
      data: {
        invoiceId,
        actor: "HUMAN",
        userId,
        action: "FIELD_CORRECTED",
        reason: `${userEmail} corrected: ${summary}`.slice(0, 1000),
        metadata: { changes, recomputedFlags: newFlags, duplicateOf },
      },
    }),
  ]);

  return { changed: true as const, changes, flags: updated.flags };
}
