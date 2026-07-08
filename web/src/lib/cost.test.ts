import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "./cost";

// Default rates: $0.10/M input, $0.40/M output
describe("estimateCostUsd", () => {
  it("prices a typical invoice extraction", () => {
    // ~2k prompt tokens (PDF + prompt), ~200 output tokens
    expect(estimateCostUsd({ promptTokens: 2000, outputTokens: 200 })).toBe(
      "0.000280",
    );
  });

  it("prices a million of each at the sum of the rates", () => {
    expect(
      estimateCostUsd({ promptTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe("0.500000");
  });

  it("is zero for zero tokens", () => {
    expect(estimateCostUsd({ promptTokens: 0, outputTokens: 0 })).toBe(
      "0.000000",
    );
  });
});
