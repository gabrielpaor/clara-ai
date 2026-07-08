// Integration test (hits the real dev database): proves the state
// machine's optimistic-concurrency guard. Two transitions race for the
// same invoice — exactly one must win, and exactly one audit row must
// exist. Before the conditional-update fix, both could apply.
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { InvalidTransitionError, transitionInvoice } from "@/lib/invoices";

const created: string[] = [];

async function makeInvoice() {
  const invoice = await prisma.invoice.create({
    data: {
      source: "UPLOAD",
      fileName: "race-test.pdf",
      mimeType: "application/pdf",
      storagePath: "",
    },
  });
  created.push(invoice.id);
  return invoice;
}

afterAll(async () => {
  // AuditLog rows cascade with the invoice
  await prisma.invoice.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("transitionInvoice under concurrency", () => {
  it("lets exactly one of two racing transitions win", async () => {
    const invoice = await makeInvoice(); // status RECEIVED

    // Both targets are valid from RECEIVED — the race is the only reason
    // one of them must fail.
    const results = await Promise.allSettled([
      transitionInvoice({
        invoiceId: invoice.id,
        to: "EXTRACTING",
        actor: "SYSTEM",
        action: "RACE_TEST_A",
      }),
      transitionInvoice({
        invoiceId: invoice.id,
        to: "FAILED",
        actor: "SYSTEM",
        action: "RACE_TEST_B",
      }),
    ]);

    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter((r) => r.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(
      (losses[0] as PromiseRejectedResult).reason,
    ).toBeInstanceOf(InvalidTransitionError);

    // Exactly one transition audit row (plus none from the loser)
    const auditCount = await prisma.auditLog.count({
      where: { invoiceId: invoice.id, action: { startsWith: "RACE_TEST" } },
    });
    expect(auditCount).toBe(1);
  });

  it("still rejects plainly invalid transitions", async () => {
    const invoice = await makeInvoice(); // RECEIVED
    await expect(
      transitionInvoice({
        invoiceId: invoice.id,
        to: "PAID",
        actor: "SYSTEM",
        action: "RACE_TEST_INVALID",
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});
