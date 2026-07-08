// Deterministic enrichment of extracted invoice data: vendor matching
// against master data + sanity flags. Shared by the extraction callback
// (first pass over AI output) and the correction service (re-run after a
// human edits fields — fixing a vendor name should clear UNKNOWN_VENDOR
// by itself, and introducing a colliding invoice number should raise
// DUPLICATE_SUSPECTED, without either path re-implementing the rules).
import { prisma } from "@/lib/db";
import type { ExtractedFields } from "@/lib/validation/extraction";

export async function computeFlagsAndVendor(
  invoiceId: string,
  data: ExtractedFields,
) {
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
