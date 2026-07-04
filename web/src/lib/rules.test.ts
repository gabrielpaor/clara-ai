import { describe, expect, it } from "vitest";
import { evaluateInvoice, type DecisionInput } from "./rules";

// A baseline invoice that passes every check; each test breaks one thing.
function cleanInput(): DecisionInput {
  return {
    data: {
      vendorName: "CloudHost Solutions Ltd.",
      invoiceNumber: "CH-2026-1107",
      invoiceDate: "2026-07-01",
      dueDate: "2026-07-31",
      currency: "USD",
      subtotal: 180.0,
      tax: 21.6,
      total: 201.6,
    },
    confidence: 0.97,
    vendorMatched: true,
    flags: [],
  };
}

describe("evaluateInvoice", () => {
  it("auto-approves a clean, small invoice from a known vendor", () => {
    const decision = evaluateInvoice(cleanInput());
    expect(decision.approve).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it("routes to review when confidence is below threshold", () => {
    const decision = evaluateInvoice({ ...cleanInput(), confidence: 0.6 });
    expect(decision.approve).toBe(false);
    expect(decision.reasons.join()).toContain("confidence");
  });

  it("routes to review when the vendor is unknown", () => {
    const decision = evaluateInvoice({ ...cleanInput(), vendorMatched: false });
    expect(decision.approve).toBe(false);
    expect(decision.reasons.join()).toContain("vendor");
  });

  it("routes to review when any flag is raised", () => {
    const decision = evaluateInvoice({
      ...cleanInput(),
      flags: ["DUPLICATE_SUSPECTED"],
    });
    expect(decision.approve).toBe(false);
    expect(decision.reasons.join()).toContain("DUPLICATE_SUSPECTED");
  });

  it("routes to review when the total exceeds the auto-approve limit", () => {
    const input = cleanInput();
    input.data.total = 12500;
    const decision = evaluateInvoice(input);
    expect(decision.approve).toBe(false);
    expect(decision.reasons.join()).toContain("exceeds auto-approve limit");
  });

  it("routes to review when required fields are missing", () => {
    const input = cleanInput();
    input.data.invoiceNumber = null;
    const decision = evaluateInvoice(input);
    expect(decision.approve).toBe(false);
    expect(decision.reasons.join()).toContain("missing required fields");
  });

  it("never auto-approves a zero or negative total", () => {
    const input = cleanInput();
    input.data.total = 0;
    expect(evaluateInvoice(input).approve).toBe(false);
  });
});
