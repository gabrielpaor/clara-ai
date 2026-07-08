// Integration tests (real dev database) for the correction service:
// audited field edits + deterministic flag recompute.
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyCorrections,
  CorrectionNotAllowedError,
  HUMAN_CORRECTED_FLAG,
} from "@/lib/corrections";
import { prisma } from "@/lib/db";

const created: string[] = [];

async function makeReviewInvoice(overrides: Record<string, unknown> = {}) {
  const invoice = await prisma.invoice.create({
    data: {
      source: "UPLOAD",
      fileName: "corrections-test.pdf",
      mimeType: "application/pdf",
      storagePath: "",
      status: "NEEDS_REVIEW",
      vendorNameRaw: "Acme Ofice Suplies", // typo'd on purpose
      invoiceNumber: "CORR-TEST-001",
      currency: "USD",
      subtotal: "100.00",
      tax: "12.00",
      total: "112.00",
      flags: ["UNKNOWN_VENDOR"],
      confidence: 0.9,
      ...overrides,
    },
  });
  created.push(invoice.id);
  return invoice;
}

async function testUser() {
  return prisma.user.findFirstOrThrow({ select: { id: true, email: true } });
}

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("applyCorrections", () => {
  it("fixing a typo'd vendor name clears UNKNOWN_VENDOR and links the vendor", async () => {
    const invoice = await makeReviewInvoice();
    const user = await testUser();

    const result = await applyCorrections({
      invoiceId: invoice.id,
      userId: user.id,
      userEmail: user.email,
      input: { vendorName: "Acme Office Supplies Inc." }, // seeded vendor
    });

    expect(result.changed).toBe(true);
    expect(result.flags).not.toContain("UNKNOWN_VENDOR");
    expect(result.flags).toContain(HUMAN_CORRECTED_FLAG);

    const updated = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { vendor: true },
    });
    expect(updated.vendor?.name).toBe("Acme Office Supplies Inc.");
    expect(updated.status).toBe("NEEDS_REVIEW"); // corrections never change status

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { invoiceId: invoice.id, action: "FIELD_CORRECTED" },
    });
    expect(audit.actor).toBe("HUMAN");
    expect(audit.userId).toBe(user.id);
    const meta = audit.metadata as { changes: Record<string, { from: unknown; to: unknown }> };
    expect(meta.changes.vendorName.from).toBe("Acme Ofice Suplies");
    expect(meta.changes.vendorName.to).toBe("Acme Office Supplies Inc.");
  });

  it("breaking the totals raises TOTALS_MISMATCH on recompute", async () => {
    const invoice = await makeReviewInvoice({
      invoiceNumber: "CORR-TEST-002",
      flags: [],
    });
    const user = await testUser();

    const result = await applyCorrections({
      invoiceId: invoice.id,
      userId: user.id,
      userEmail: user.email,
      input: { total: 999 },
    });
    expect(result.flags).toContain("TOTALS_MISMATCH");
  });

  it("is a no-op when nothing actually changes", async () => {
    const invoice = await makeReviewInvoice({ invoiceNumber: "CORR-TEST-003" });
    const user = await testUser();

    const result = await applyCorrections({
      invoiceId: invoice.id,
      userId: user.id,
      userEmail: user.email,
      input: { invoiceNumber: "CORR-TEST-003", total: 112 },
    });
    expect(result.changed).toBe(false);

    const auditCount = await prisma.auditLog.count({
      where: { invoiceId: invoice.id, action: "FIELD_CORRECTED" },
    });
    expect(auditCount).toBe(0);
  });

  it("refuses corrections outside NEEDS_REVIEW", async () => {
    const invoice = await makeReviewInvoice({
      invoiceNumber: "CORR-TEST-004",
      status: "APPROVED",
    });
    const user = await testUser();

    await expect(
      applyCorrections({
        invoiceId: invoice.id,
        userId: user.id,
        userEmail: user.email,
        input: { total: 50 },
      }),
    ).rejects.toBeInstanceOf(CorrectionNotAllowedError);
  });
});
